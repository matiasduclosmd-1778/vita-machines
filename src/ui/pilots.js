// Imágenes de los pilotos (retratos y vehículos), compartidas por el menú y el podio.

// Vite las optimiza y devuelve sus URLs
const PILOT_IMAGES = import.meta.glob('../assets/pilots/*.webp', { query: '?url', import: 'default', eager: true });
export const pilotImage = (file) => (file ? PILOT_IMAGES[`../assets/pilots/${file}`] : undefined);

// Renders del vehículo para los pilotos sin ilustración del auto ({ id del piloto → url }, ver main.js)
const VEHICLE_RENDERS = {};
export const setVehicleRenders = (renders) => Object.assign(VEHICLE_RENDERS, renders);

/** Imagen del vehículo de un piloto: su ilustración o, si no tiene, el render del modelo 3D. */
export const vehicleImage = (d) => (d.carImage ? pilotImage(d.carImage) : VEHICLE_RENDERS[d.id]);

/** Iniciales para los pilotos sin retrato ("PabloQuemandoRuedas" → "PQR"). */
export const initials = (name) => (name.match(/[A-ZÁÉÍÓÚÑ]/g) ?? [name[0]]).slice(0, 3).join('');

/** Nombre con cortes posibles entre palabras pegadas ("Pablo<wbr>Quemando<wbr>Ruedas"), ya escapado. */
export const breakableName = (escaped) => escaped.replace(/([a-záéíóúñ])(?=[A-ZÁÉÍÓÚÑ])/g, '$1<wbr>');
