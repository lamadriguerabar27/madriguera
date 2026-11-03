import { n } from './format.js';

export const costoReceta = (receta, insumos) =>
  receta.reduce((s, r) => s + n(r.cantidad) * n(insumos.find((i) => i.id === Number(r.insumo))?.costo_unitario), 0);

export const costoDirecto = (p) => (p.tipo === 'reventa' && n(p.costo_compra) > 0 ? n(p.costo_compra) / (n(p.unidades_por_compra) || 1) : 0);

/** Precio para que (precio − costo) / precio = margen. Con redondeo, hacia arriba. */
export const precioConMargen = (costo, margen, redondeo = 0) => {
  const m = n(margen);
  if (costo <= 0 || m >= 100) return 0;
  const bruto = costo / (1 - m / 100);
  if (!redondeo) return Math.round(bruto);
  return Math.ceil(bruto / redondeo - 1e-9) * redondeo;
};

export const margenReal = (precio, costo) => (n(precio) > 0 ? ((n(precio) - costo) / n(precio)) * 100 : null);
