const cop = new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 });
const num = new Intl.NumberFormat('es-CO', { maximumFractionDigits: 2 });

export const pesos = (v) => (v == null || Number.isNaN(Number(v)) ? '—' : cop.format(Math.round(Number(v))));
export const numero = (v, d = 2) =>
  v == null ? '—' : new Intl.NumberFormat('es-CO', { maximumFractionDigits: d }).format(Number(v));
export const pct = (v, d = 1) => (v == null ? '—' : `${num.format(Number(Number(v).toFixed(d)))}%`);
export const n = (v) => {
  const x = Number(v);
  return Number.isFinite(x) ? x : 0;
};

const pad = (x) => String(x).padStart(2, '0');
export const hoy = () => {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};
export const mesActual = () => hoy().slice(0, 7);
export const rangoMes = (mes) => {
  const [y, m] = mes.split('-').map(Number);
  const ultimo = new Date(y, m, 0).getDate();
  return { desde: `${mes}-01`, hasta: `${mes}-${pad(ultimo)}` };
};
export const fechaCorta = (iso) => {
  if (!iso) return '—';
  const [y, m, d] = iso.slice(0, 10).split('-');
  return `${d}/${m}/${y}`;
};
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
export const nombreMes = (mes) => {
  const [y, m] = mes.split('-').map(Number);
  return `${MESES[m - 1]} ${y}`;
};
export const UNIDAD = { oz: 'oz', ml: 'ml', unidad: 'und', g: 'g' };
