import { n } from './format.js';

export const costoReceta = (receta, insumos) =>
  receta.reduce((s, r) => s + n(r.cantidad) * n(insumos.find((i) => i.id === Number(r.insumo))?.costo_unitario), 0);

/** Precio para que (precio − costo) / precio = margen, redondeado hacia arriba. */
export const precioSugerido = (costo, margen, redondeo = 1) => {
  if (costo <= 0) return 0;
  const bruto = costo / (1 - n(margen) / 100);
  const paso = Math.max(1, n(redondeo));
  return Math.ceil(bruto / paso - 1e-9) * paso;
};

export const margenReal = (precio, costo) => (n(precio) > 0 ? ((n(precio) - costo) / n(precio)) * 100 : null);
