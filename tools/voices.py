#!/usr/bin/env python3
"""
Tratamiento de las voces del juego (estética synthwave: locutor de arcade de los 80).

    python3 tools/voices.py

Lee los clips originales de NewSound/ (.m4a), los procesa y deja las versiones del juego en
src/assets/voices/ (.m4a, AAC estéreo). Necesita numpy y scipy, y `afconvert` (macOS) para leer y
escribir AAC.

Cadena por clip:
  1. Limpieza: reducción de ruido espectral (perfil del ruido de fondo) y recorte de silencios.
  2. Tono: baja `semitones` sin cambiar la duración (vocoder de fase con bloqueo de fase + remuestreo).
     Las formantes bajan junto con el tono → voz más grande, de locutor.
  3. Capa una octava abajo (peso épico) y vocoder con un acorde de La menor 7 (armonía de sintetizador).
  4. Ecualización (graves limpios, presencia, aire), saturación suave y compresión.
  5. Chorus estéreo, delay ping-pong a tempo (corchea con puntillo a 118 BPM) y reverb amplia.
  6. Nivel parejo entre clips y limitador.
"""
import os
import subprocess
import sys
import tempfile
from fractions import Fraction

import numpy as np
from scipy import signal
from scipy.io import wavfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, 'NewSound')
OUT = os.path.join(ROOT, 'src', 'assets', 'voices')
SR = 48000

# Clip original → archivo del juego y ajustes propios
CLIPS = {
    'TheWinner-Is': dict(out='winner', semitones=-4.0, vocoder=0.3, octave=0.25, reverb=0.3, delay=0.3),
    'Coco-Name': dict(out='coco', semitones=-2.0, vocoder=0.22, octave=0.2, reverb=0.2, delay=0.2),
    'Pablo-Name': dict(out='pablo', semitones=-3.5, vocoder=0.22, octave=0.2, reverb=0.2, delay=0.2),
    'Fachu-Name': dict(out='faxo', semitones=-1.5, vocoder=0.22, octave=0.2, reverb=0.2, delay=0.2),
    'Dj-Domono-Name': dict(out='domono', semitones=-2.5, vocoder=0.22, octave=0.2, reverb=0.2, delay=0.2),
}

BPM = 118  # tempo del menú: el eco cae a tiempo con la música
CHORD = [110.0, 130.81, 164.81, 196.0]  # La menor 7 (A C E G): encaja con el menú (La menor) y el podio (Do mayor)
TARGET_RMS_DB = -17.0
PEAK_DB = -1.0


# ------------------------------------------------------------------ entrada / salida

def read(path):
    with tempfile.TemporaryDirectory() as tmp:
        wav = os.path.join(tmp, 'in.wav')
        subprocess.run(['afconvert', '-f', 'WAVE', '-d', f'LEF32@{SR}', '-c', '1', path, wav], check=True)
        sr, x = wavfile.read(wav)
    x = x.astype(np.float64)
    return x.mean(axis=1) if x.ndim > 1 else x


def write_m4a(path, stereo):
    with tempfile.TemporaryDirectory() as tmp:
        wav = os.path.join(tmp, 'out.wav')
        wavfile.write(wav, SR, (np.clip(stereo, -1, 1) * 32767).astype(np.int16))
        subprocess.run(['afconvert', '-f', 'm4af', '-d', 'aac', '-b', '160000', wav, path], check=True)


# ------------------------------------------------------------------ utilidades

def db(x):
    return 20 * np.log10(np.maximum(x, 1e-12))


def biquad(kind, f, q=0.707, gain_db=0.0):
    """Coeficientes RBJ (cookbook) → sos."""
    A = 10 ** (gain_db / 40)
    w0 = 2 * np.pi * f / SR
    cw, sw = np.cos(w0), np.sin(w0)
    alpha = sw / (2 * q)
    if kind == 'peak':
        b = [1 + alpha * A, -2 * cw, 1 - alpha * A]
        a = [1 + alpha / A, -2 * cw, 1 - alpha / A]
    elif kind == 'lowshelf':
        s = 2 * np.sqrt(A) * alpha
        b = [A * ((A + 1) - (A - 1) * cw + s), 2 * A * ((A - 1) - (A + 1) * cw), A * ((A + 1) - (A - 1) * cw - s)]
        a = [(A + 1) + (A - 1) * cw + s, -2 * ((A - 1) + (A + 1) * cw), (A + 1) + (A - 1) * cw - s]
    elif kind == 'highshelf':
        s = 2 * np.sqrt(A) * alpha
        b = [A * ((A + 1) + (A - 1) * cw + s), -2 * A * ((A - 1) + (A + 1) * cw), A * ((A + 1) + (A - 1) * cw - s)]
        a = [(A + 1) - (A - 1) * cw + s, 2 * ((A - 1) - (A + 1) * cw), (A + 1) - (A - 1) * cw - s]
    else:
        raise ValueError(kind)
    return signal.tf2sos(np.array(b) / a[0], np.array(a) / a[0])


def eq(x, *bands):
    for band in bands:
        x = signal.sosfilt(band, x)
    return x


def lowpass(x, f, order=2):
    return signal.sosfilt(signal.butter(order, f, 'low', fs=SR, output='sos'), x)


def highpass(x, f, order=2):
    return signal.sosfilt(signal.butter(order, f, 'high', fs=SR, output='sos'), x)


# ------------------------------------------------------------------ 1. limpieza

def denoise(x, strength=1.6, floor=0.12):
    """Reducción de ruido espectral: perfil del ruido = magnitud baja típica de cada banda."""
    f, t, Z = signal.stft(x, SR, nperseg=1024, noverlap=768)
    mag = np.abs(Z)
    frame_energy = mag.mean(axis=0)
    quiet = mag[:, frame_energy <= np.percentile(frame_energy, 15)]
    noise = np.median(quiet, axis=1, keepdims=True) if quiet.size else np.percentile(mag, 10, axis=1, keepdims=True)
    gain = np.clip(1 - strength * noise / np.maximum(mag, 1e-9), floor, 1)
    gain = signal.convolve2d(gain, np.ones((3, 5)) / 15, mode='same', boundary='symm')  # sin "agua" musical
    _, y = signal.istft(Z * gain, SR, nperseg=1024, noverlap=768)
    return y[: len(x)]


def trim(x, threshold_db=-42, pre=0.03, post=0.08):
    fr = int(SR * 0.01)
    env = np.array([np.sqrt(np.mean(x[i:i + fr] ** 2)) for i in range(0, len(x) - fr, fr)])
    loud = np.where(db(env) > db(env.max()) + threshold_db)[0]
    a = max(0, loud[0] * fr - int(pre * SR))
    b = min(len(x), (loud[-1] + 1) * fr + int(post * SR))
    y = x[a:b].copy()
    fade = int(0.01 * SR)
    y[:fade] *= np.linspace(0, 1, fade)
    y[-fade:] *= np.linspace(1, 0, fade)
    return y


# ------------------------------------------------------------------ 2. tono

def stretch(x, factor, n=2048, ha=256):
    """Estira el tiempo por `factor` sin cambiar el tono (vocoder de fase con bloqueo de fase)."""
    hs = ha * factor
    win = signal.windows.hann(n, sym=False)
    x = np.concatenate([np.zeros(n), x, np.zeros(n)])
    frames = 1 + (len(x) - n) // ha
    bins = n // 2 + 1
    omega = 2 * np.pi * np.arange(bins) * ha / n
    out = np.zeros(int((frames - 1) * hs) + n + 2)
    norm = np.zeros_like(out)
    prev_ph = None
    syn_ph = None
    for t in range(frames):
        X = np.fft.rfft(win * x[t * ha: t * ha + n])
        mag, ph = np.abs(X), np.angle(X)
        if prev_ph is None:
            syn_ph = ph.copy()
        else:
            d = ph - prev_ph - omega
            d = (d + np.pi) % (2 * np.pi) - np.pi
            adv = (omega + d) * hs / ha
            # Bloqueo de fase: cada bin sigue al pico de su región (menos "fase" metálica)
            peaks = signal.argrelmax(mag, order=2)[0]
            new = syn_ph + adv
            if len(peaks):
                edges = np.concatenate([[0], (peaks[:-1] + peaks[1:]) // 2, [bins]])
                for p, lo, hi in zip(peaks, edges[:-1], edges[1:]):
                    new[lo:hi] = new[p] + (ph[lo:hi] - ph[p])
            syn_ph = new
        prev_ph = ph
        frame = np.fft.irfft(mag * np.exp(1j * syn_ph), n) * win
        pos = int(round(t * hs))
        out[pos: pos + n] += frame
        norm[pos: pos + n] += win ** 2
    y = out / np.maximum(norm, 1e-3)
    start = int(round(n * factor))
    return y[start: start + int(round((len(x) - 2 * n) * factor))]


def pitch_shift(x, semitones):
    if abs(semitones) < 0.01:
        return x.copy()
    r = 2 ** (semitones / 12)
    y = stretch(x, r)  # duración × r …
    frac = Fraction(1 / r).limit_denominator(400)
    y = signal.resample_poly(y, frac.numerator, frac.denominator)  # … y al remuestrear vuelve a la duración original con el tono × r
    return y[: len(x)] if len(y) >= len(x) else np.pad(y, (0, len(x) - len(y)))


# ------------------------------------------------------------------ 3. capas

def vocoder(modulator, chord=CHORD, bands=18):
    """Vocoder de canales: la voz "toca" un acorde de sierras (armonía de sintetizador)."""
    t = np.arange(len(modulator)) / SR
    carrier = np.zeros_like(modulator)
    for f in chord + [f * 2 for f in chord]:
        for det in (-0.004, 0.004):
            carrier += signal.sawtooth(2 * np.pi * f * (1 + det) * t)
    carrier += 0.3 * np.random.default_rng(1).standard_normal(len(t))  # consonantes
    edges = np.geomspace(120, 7000, bands + 1)
    env_lp = signal.butter(2, 28, 'low', fs=SR, output='sos')
    y = np.zeros_like(modulator)
    for lo, hi in zip(edges[:-1], edges[1:]):
        bp = signal.butter(2, [lo, hi], 'band', fs=SR, output='sos')
        env = signal.sosfilt(env_lp, np.abs(signal.sosfilt(bp, modulator)))
        y += signal.sosfilt(bp, carrier) * env
    return y / (np.abs(y).max() + 1e-9) * np.abs(modulator).max()


# ------------------------------------------------------------------ 4. color y dinámica

def saturate(x, drive=2.2, mix=0.4):
    peak = np.abs(x).max() + 1e-9
    wet = np.tanh(drive * x / peak) / np.tanh(drive) * peak
    return (1 - mix) * x + mix * wet


def compress(x, threshold_db=-20, ratio=4, attack=0.004, release=0.12, makeup_db=6):
    det = np.sqrt(signal.lfilter([1 - np.exp(-1 / (0.008 * SR))], [1, -np.exp(-1 / (0.008 * SR))], x ** 2))
    over = np.maximum(db(det) - threshold_db, 0)
    target = -over * (1 - 1 / ratio)
    gain = np.zeros_like(target)
    g = 0.0
    a_att = np.exp(-1 / (attack * SR))
    a_rel = np.exp(-1 / (release * SR))
    for i, v in enumerate(target):  # ataque/relevo distintos
        a = a_att if v < g else a_rel
        g = a * g + (1 - a) * v
        gain[i] = g
    return x * 10 ** ((gain + makeup_db) / 20)


# ------------------------------------------------------------------ 5. espacio (estéreo)

def chorus(x, depth_ms=2.5, base_ms=14, rate=0.45, mix=0.35):
    n = np.arange(len(x))
    out = []
    for phase in (0, np.pi / 2):
        d = (base_ms + depth_ms * np.sin(2 * np.pi * rate * n / SR + phase)) * SR / 1000
        idx = n - d
        i0 = np.clip(np.floor(idx).astype(int), 0, len(x) - 1)
        i1 = np.clip(i0 + 1, 0, len(x) - 1)
        frac = idx - np.floor(idx)
        wet = x[i0] * (1 - frac) + x[i1] * frac
        out.append((1 - mix) * x + mix * wet)
    return np.stack(out, axis=1)


def pingpong(st, mix, beats=0.75, feedback=0.4, repeats=6):
    d = int(SR * 60 / BPM * beats)
    out = np.zeros((len(st) + d * repeats, 2))
    out[: len(st)] = st
    mono = st.mean(axis=1)
    echo = mono
    for k in range(1, repeats + 1):
        echo = lowpass(highpass(echo, 250), 3500) * feedback  # cada eco más oscuro
        ch = k % 2  # alterna izquierda / derecha
        out[k * d: k * d + len(echo), ch] += echo * mix / feedback
    return out


def reverb(st, mix, seconds=2.4, decay=3.0):
    n = int(SR * seconds)
    rng = np.random.default_rng(7)
    k = np.arange(n) / n
    ir = rng.standard_normal((n, 2)) * ((1 - k) ** decay)[:, None]
    ir[: int(0.015 * SR)] = 0  # pre-delay
    ir = np.stack([lowpass(highpass(ir[:, c], 200), 7000) for c in range(2)], axis=1)
    ir /= np.sqrt((ir ** 2).sum(axis=0))
    wet = np.stack([signal.fftconvolve(st[:, c], ir[:, c]) for c in range(2)], axis=1)
    out = np.zeros_like(wet)
    out[: len(st)] = st
    return out + wet * mix * 1.6


# ------------------------------------------------------------------ clip completo

def process(x, cfg):
    x = trim(denoise(x))
    x = x / (np.abs(x).max() + 1e-9) * 0.5
    voice = pitch_shift(x, cfg['semitones'])
    low = pitch_shift(x, cfg['semitones'] - 12)
    voice = voice + cfg['octave'] * lowpass(low, 1800) + cfg['vocoder'] * vocoder(voice)
    voice = eq(
        highpass(voice, 85),
        biquad('peak', 320, 0.9, -3),       # menos "caja"
        biquad('peak', 3200, 0.8, 4),       # presencia
        biquad('highshelf', 9000, 0.7, 3),  # aire
        biquad('lowshelf', 140, 0.7, 2),    # cuerpo
    )
    voice = compress(saturate(voice))
    st = chorus(voice)
    st = pingpong(st, cfg['delay'])
    st = reverb(st, cfg['reverb'])
    # Nivel parejo (RMS de la parte con voz) y limitador suave
    active = st[np.abs(st).max(axis=1) > 0.02 * np.abs(st).max()]
    st *= 10 ** (TARGET_RMS_DB / 20) / (np.sqrt(np.mean(active ** 2)) + 1e-9)
    ceiling = 10 ** (PEAK_DB / 20)
    st = np.where(np.abs(st) > ceiling * 0.8, np.sign(st) * (ceiling * 0.8 + (ceiling * 0.2) * np.tanh((np.abs(st) - ceiling * 0.8) / (ceiling * 0.2))), st)
    # Cola: se corta cuando ya no se escucha, con fundido
    env = db(np.abs(st).max(axis=1))
    last = np.where(env > -60)[0][-1]
    st = st[: last + int(0.05 * SR)]
    fade = int(0.3 * SR)
    st[-fade:] *= np.linspace(1, 0, fade)[:, None]
    return st


def main():
    os.makedirs(OUT, exist_ok=True)
    for name, cfg in CLIPS.items():
        src = os.path.join(SRC, f'{name}.m4a')
        if not os.path.exists(src):
            print(f'falta {src}', file=sys.stderr)
            continue
        y = process(read(src), cfg)
        dst = os.path.join(OUT, f"{cfg['out']}.m4a")
        write_m4a(dst, y)
        rms = db(np.sqrt(np.mean(y ** 2)))
        print(f"{name:16s} → {os.path.relpath(dst, ROOT)}  {len(y) / SR:.2f}s  pico {db(np.abs(y).max()):.1f} dB  rms {rms:.1f} dB")


if __name__ == '__main__':
    main()
