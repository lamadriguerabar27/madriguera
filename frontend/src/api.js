const BASE = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '');
const CLAVE = 'madriguera_sesion';

export const sesion = {
  leer() {
    try { return JSON.parse(localStorage.getItem(CLAVE)) || null; } catch { return null; }
  },
  guardar(t) { localStorage.setItem(CLAVE, JSON.stringify(t)); },
  borrar() { localStorage.removeItem(CLAVE); },
};

export class ErrorApi extends Error {
  constructor(status, data) {
    super(mensajeDe(data) || `Error ${status}`);
    this.status = status;
    this.data = data;
  }
}

function mensajeDe(data) {
  if (!data) return '';
  if (typeof data === 'string') return data.slice(0, 300);
  if (data.detail) return data.errores ? `${data.detail} ${data.errores.join(' ')}` : data.detail;
  const partes = [];
  for (const [k, v] of Object.entries(data)) {
    const t = Array.isArray(v) ? v.map((x) => (typeof x === 'object' ? mensajeDe(x) : x)).join(' ') : typeof v === 'object' ? mensajeDe(v) : v;
    partes.push(k === 'non_field_errors' ? t : `${k}: ${t}`);
  }
  return partes.join(' · ');
}

let refrescando = null;
async function refrescar() {
  const s = sesion.leer();
  if (!s?.refresh) return false;
  refrescando ||= fetch(`${BASE}/api/auth/refresh/`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ refresh: s.refresh }),
  }).then(async (r) => {
    if (!r.ok) return false;
    const d = await r.json();
    sesion.guardar({ access: d.access, refresh: d.refresh || s.refresh });
    return true;
  }).catch(() => false).finally(() => { setTimeout(() => { refrescando = null; }, 0); });
  return refrescando;
}

export async function api(ruta, { metodo = 'GET', datos, archivo, reintento = true } = {}) {
  const s = sesion.leer();
  const headers = {};
  let body;
  if (archivo) {
    body = archivo;
  } else if (datos !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(datos);
  }
  if (s?.access) headers.Authorization = `Bearer ${s.access}`;
  let r;
  try {
    r = await fetch(`${BASE}/api/${ruta}`, { method: metodo, headers, body });
  } catch {
    throw new ErrorApi(0, 'No hay conexión con el servidor. Revisa tu internet e inténtalo de nuevo.');
  }
  if (r.status === 401 && reintento && s?.refresh) {
    if (await refrescar()) return api(ruta, { metodo, datos, archivo, reintento: false });
    sesion.borrar();
    window.dispatchEvent(new Event('sesion-cerrada'));
  }
  if (r.status === 204) return null;
  const tipo = r.headers.get('content-type') || '';
  const data = tipo.includes('json') ? await r.json() : await r.text();
  if (!r.ok) throw new ErrorApi(r.status, data);
  return data;
}

export async function login(username, password) {
  const r = await fetch(`${BASE}/api/auth/login/`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password }),
  }).catch(() => null);
  if (!r) throw new ErrorApi(0, 'No hay conexión con el servidor.');
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new ErrorApi(r.status, r.status === 401 ? 'Usuario o contraseña incorrectos.' : d);
  sesion.guardar({ access: d.access, refresh: d.refresh });
}
