import { useState } from 'react';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';
import { Campo, Encabezado, useMensaje } from '../components/ui.jsx';
import { n, numero, pesos, UNIDAD } from '../format.js';
import { useApi } from '../hooks.js';

const NUEVO = {
  nombre: '', categoria: 'licor', unidad: 'oz', costo_unitario: '', contenido_presentacion: '', unidad_presentacion: 'ml',
  costo_presentacion: '', controla_stock: true, stock_minimo: '', stock_inicial: '', activo: true,
};
const ML = { ml: 1, l: 1000 };

function costoCalculado(f, mlOz) {
  if (!n(f.contenido_presentacion) || !f.costo_presentacion) return null;
  const de = f.unidad_presentacion, a = f.unidad;
  let unidades;
  if (de === a) unidades = n(f.contenido_presentacion);
  else if (['ml', 'oz'].includes(de) && ['ml', 'oz'].includes(a)) {
    const ml = de === 'oz' ? n(f.contenido_presentacion) * mlOz : n(f.contenido_presentacion) * (ML[de] || 1);
    unidades = a === 'oz' ? ml / mlOz : ml;
  } else return null;
  return unidades > 0 ? { porUnidad: n(f.costo_presentacion) / unidades, unidades } : null;
}

export default function Insumos() {
  const { esAdmin } = useAuth();
  const lista = useApi('insumos/');
  const cfg = useApi('configuracion/');
  const ops = useApi('opciones/costos/');
  const [f, setF] = useState(null);
  const [ajuste, setAjuste] = useState(null);
  const [filtro, setFiltro] = useState('');
  const [soloBajo, setSoloBajo] = useState(false);
  const [mensaje, avisar] = useMensaje();
  const mlOz = n(cfg.datos?.ml_por_onza || 30);

  const abrir = (i) => setF(i ? {
    ...i, costo_unitario: String(n(i.costo_unitario)), contenido_presentacion: i.contenido_presentacion ? String(n(i.contenido_presentacion)) : '',
    unidad_presentacion: i.unidad_presentacion || 'ml', costo_presentacion: i.costo_presentacion ? String(n(i.costo_presentacion)) : '',
    stock_minimo: String(n(i.stock_minimo)),
  } : { ...NUEVO });

  const calc = f ? costoCalculado(f, mlOz) : null;
  const usaPresentacion = f && (f.contenido_presentacion || f.costo_presentacion);

  const guardar = async () => {
    const datos = {
      ...f, costo_unitario: n(f.costo_unitario), stock_minimo: n(f.stock_minimo),
      contenido_presentacion: usaPresentacion ? n(f.contenido_presentacion) : null,
      unidad_presentacion: usaPresentacion ? f.unidad_presentacion : '',
      costo_presentacion: usaPresentacion ? n(f.costo_presentacion) : null,
    };
    if (f.id) delete datos.stock_inicial; else datos.stock_inicial = n(f.stock_inicial) || undefined;
    try {
      await api(f.id ? `insumos/${f.id}/` : 'insumos/', { metodo: f.id ? 'PUT' : 'POST', datos });
      avisar('bien', `«${f.nombre}» guardado.`);
      setF(null);
      lista.recargar();
    } catch (err) { avisar('mal', err.message); }
  };

  const ajustar = async () => {
    try {
      await api(`insumos/${ajuste.id}/ajustar/`, { metodo: 'POST', datos: { stock_real: n(ajuste.stock_real), nota: ajuste.nota } });
      avisar('bien', 'Inventario ajustado.');
      setAjuste(null);
      lista.recargar();
    } catch (err) { avisar('mal', err.message); }
  };

  const filas = (lista.datos || []).filter((i) => (!filtro || i.nombre.toLowerCase().includes(filtro.toLowerCase())) && (!soloBajo || i.stock_bajo));
  const bajos = (lista.datos || []).filter((i) => i.stock_bajo && i.activo).length;

  return (
    <div className="pila">
      <Encabezado titulo="Insumos e inventario" acciones={esAdmin && <button type="button" className="boton" onClick={() => abrir(null)}>Nuevo insumo</button>}>
        Lo que compras para preparar: licores y cervezas, fruta, servilletas, pinchos, envío. Los licores se cuentan en onzas ({numero(mlOz, 1)} ml por onza).
      </Encabezado>
      {mensaje}
      {bajos > 0 && <p className="aviso mal">{bajos} insumo(s) están en o por debajo del stock mínimo.</p>}

      {f && (
        <section className="tarjeta">
          <div className="tarjeta-cabeza"><h2>{f.id ? f.nombre : 'Nuevo insumo'}</h2><button type="button" className="enlace" onClick={() => setF(null)}>Cerrar</button></div>
          <div className="form">
            <Campo etiqueta="Nombre" className="ancho"><input value={f.nombre} onChange={(e) => setF({ ...f, nombre: e.target.value })} placeholder="Ej.: Ron blanco, Limón, Servilleta" /></Campo>
            <Campo etiqueta="Categoría" className="medio">
              <select value={f.categoria} onChange={(e) => setF({ ...f, categoria: e.target.value, controla_stock: e.target.value !== 'servicio' })}>
                {(ops.datos?.categorias_insumo || []).map((c) => <option key={c.valor} value={c.valor}>{c.nombre}</option>)}
              </select>
            </Campo>
            <Campo etiqueta="Se usa y se cuenta en" className="medio">
              <select value={f.unidad} onChange={(e) => setF({ ...f, unidad: e.target.value })}>
                {(ops.datos?.unidades || []).map((u) => <option key={u.valor} value={u.valor}>{u.nombre}</option>)}
              </select>
            </Campo>
          </div>
          <h3 style={{ margin: '16px 0 6px' }}>Costo</h3>
          <p style={{ color: 'var(--tinta-suave)', marginBottom: 8 }}>Escribe cómo lo compras (ej. botella de 750 ml a $80.000) y calculamos el costo por {UNIDAD[f.unidad]}. O escribe directamente el costo por unidad.</p>
          <div className="form">
            <Campo etiqueta="Contenido de la presentación" className="medio"><input type="number" min="0" step="any" value={f.contenido_presentacion} onChange={(e) => setF({ ...f, contenido_presentacion: e.target.value })} placeholder="750" /></Campo>
            <Campo etiqueta="Medido en" className="corto">
              <select value={f.unidad_presentacion} onChange={(e) => setF({ ...f, unidad_presentacion: e.target.value })}>
                {(ops.datos?.unidades || []).map((u) => <option key={u.valor} value={u.valor}>{u.nombre}</option>)}
              </select>
            </Campo>
            <Campo etiqueta="Costo de la presentación" className="medio"><input type="number" min="0" step="100" value={f.costo_presentacion} onChange={(e) => setF({ ...f, costo_presentacion: e.target.value })} placeholder="80000" /></Campo>
            <span style={{ alignSelf: 'center', color: 'var(--tinta-suave)' }}>o</span>
            <Campo etiqueta={`Costo por ${UNIDAD[f.unidad]}`} className="medio"><input type="number" min="0" step="any" value={usaPresentacion ? (calc ? calc.porUnidad.toFixed(2) : '') : f.costo_unitario} disabled={!!usaPresentacion} onChange={(e) => setF({ ...f, costo_unitario: e.target.value })} /></Campo>
          </div>
          {calc && <p className="aviso info" style={{ marginTop: 10 }}>Cada presentación trae {numero(calc.unidades, 2)} {UNIDAD[f.unidad]}; cada {UNIDAD[f.unidad]} cuesta {pesos(calc.porUnidad)}.</p>}
          {usaPresentacion && !calc && <p className="aviso mal" style={{ marginTop: 10 }}>Completa el contenido y el costo, y usa unidades compatibles (ml u oz para líquidos).</p>}
          <h3 style={{ margin: '16px 0 6px' }}>Inventario</h3>
          <div className="form">
            <label className="check"><input type="checkbox" checked={f.controla_stock} onChange={(e) => setF({ ...f, controla_stock: e.target.checked })} /> Llevar inventario</label>
            {!f.id && f.controla_stock && <Campo etiqueta={`Stock inicial (${UNIDAD[f.unidad]})`} className="medio"><input type="number" min="0" step="any" value={f.stock_inicial} onChange={(e) => setF({ ...f, stock_inicial: e.target.value })} /></Campo>}
            {f.controla_stock && <Campo etiqueta={`Avisar cuando queden (${UNIDAD[f.unidad]})`} className="medio"><input type="number" min="0" step="any" value={f.stock_minimo} onChange={(e) => setF({ ...f, stock_minimo: e.target.value })} /></Campo>}
            {f.id && <label className="check"><input type="checkbox" checked={f.activo} onChange={(e) => setF({ ...f, activo: e.target.checked })} /> Activo</label>}
          </div>
          <div className="form" style={{ marginTop: 14 }}><button type="button" className="boton" onClick={guardar} disabled={!f.nombre}>Guardar insumo</button></div>
        </section>
      )}

      {ajuste && (
        <section className="tarjeta">
          <div className="tarjeta-cabeza"><h2>Conteo físico: {ajuste.nombre}</h2><button type="button" className="enlace" onClick={() => setAjuste(null)}>Cerrar</button></div>
          <p>El sistema dice que hay {numero(ajuste.stock)} {UNIDAD[ajuste.unidad]}. Escribe lo que hay de verdad y guardamos la diferencia como ajuste.</p>
          <div className="form" style={{ marginTop: 10 }}>
            <Campo etiqueta={`Hay realmente (${UNIDAD[ajuste.unidad]})`} className="medio"><input type="number" min="0" step="any" value={ajuste.stock_real} onChange={(e) => setAjuste({ ...ajuste, stock_real: e.target.value })} /></Campo>
            <Campo etiqueta="Nota" className="ancho"><input value={ajuste.nota} onChange={(e) => setAjuste({ ...ajuste, nota: e.target.value })} placeholder="Ej.: conteo del domingo, botella rota" /></Campo>
            <button type="button" className="boton" onClick={ajustar} disabled={ajuste.stock_real === ''}>Guardar conteo</button>
          </div>
        </section>
      )}

      <section className="tarjeta">
        <div className="form" style={{ marginBottom: 10 }}>
          <Campo etiqueta="Buscar" className="ancho"><input value={filtro} onChange={(e) => setFiltro(e.target.value)} /></Campo>
          <label className="check"><input type="checkbox" checked={soloBajo} onChange={(e) => setSoloBajo(e.target.checked)} /> Solo los que hay que comprar</label>
        </div>
        {filas.length ? (
          <div className="tabla-caja">
            <table>
              <thead><tr><th>Insumo</th><th>Categoría</th><th className="n">Costo por unidad</th><th className="n">Stock</th><th className="n">Presentaciones</th><th />{esAdmin && <th />}</tr></thead>
              <tbody>
                {filas.map((i) => (
                  <tr key={i.id} className={esAdmin ? 'clic' : ''} onClick={() => esAdmin && abrir(i)}>
                    <td>{i.nombre}{!i.activo && <span className="etiqueta" style={{ marginLeft: 6 }}>Inactivo</span>}</td>
                    <td>{i.categoria_nombre}</td>
                    <td className="n">{pesos(i.costo_unitario)} / {UNIDAD[i.unidad]}</td>
                    <td className="n">{i.controla_stock ? `${numero(i.stock)} ${UNIDAD[i.unidad]}` : '—'}</td>
                    <td className="n">{i.presentaciones_en_stock != null ? numero(i.presentaciones_en_stock, 1) : '—'}</td>
                    <td>{i.stock_bajo && <span className="etiqueta alerta">Comprar</span>}</td>
                    {esAdmin && <td>{i.controla_stock && <button type="button" className="boton secundario chico" onClick={(e) => { e.stopPropagation(); setAjuste({ ...i, stock_real: '', nota: '' }); }}>Contar</button>}</td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <p className="vacio">{lista.datos?.length ? 'Ningún insumo coincide con la búsqueda.' : 'Aún no hay insumos. Créalos aquí o cárgalos desde una factura.'}</p>}
      </section>
    </div>
  );
}
