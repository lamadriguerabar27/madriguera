import { useMemo, useState } from 'react';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';
import { Campo, Encabezado, useMensaje } from '../components/ui.jsx';
import { costoReceta, margenReal, precioSugerido } from '../costeo.js';
import { n, numero, pct, pesos, UNIDAD } from '../format.js';
import { useApi } from '../hooks.js';

const NUEVO = { nombre: '', categoria: 'coctel', descripcion: '', precio_venta: '', margen_objetivo: '', activo: true, receta: [] };

export default function Carta() {
  const { esAdmin } = useAuth();
  const productos = useApi('productos/');
  const insumos = useApi('insumos/?activos=1');
  const cfg = useApi('configuracion/');
  const ops = useApi('opciones/costos/');
  const [p, setP] = useState(null);
  const [mensaje, avisar] = useMensaje();

  const lista = productos.datos || [];
  const ins = insumos.datos || [];
  const margenCfg = n(cfg.datos?.margen_objetivo ?? 40);
  const redondeo = n(cfg.datos?.redondeo_precio ?? 500);

  const abrir = (prod) => {
    setP(prod ? {
      ...prod, precio_venta: String(n(prod.precio_venta)), margen_objetivo: prod.margen_objetivo == null ? '' : String(n(prod.margen_objetivo)),
      receta: prod.receta.map((r) => ({ insumo: String(r.insumo), cantidad: String(n(r.cantidad)) })),
    } : { ...NUEVO });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const guardar = async () => {
    const datos = {
      ...p, precio_venta: n(p.precio_venta), margen_objetivo: p.margen_objetivo === '' ? null : n(p.margen_objetivo),
      receta: p.receta.filter((r) => r.insumo && n(r.cantidad) > 0).map((r) => ({ insumo: Number(r.insumo), cantidad: n(r.cantidad) })),
    };
    try {
      const r = await api(p.id ? `productos/${p.id}/` : 'productos/', { metodo: p.id ? 'PUT' : 'POST', datos });
      avisar('bien', `«${r.nombre}» guardado.`);
      productos.recargar();
      abrir(r);
    } catch (err) { avisar('mal', err.message); }
  };

  const borrar = async () => {
    try {
      const r = await api(`productos/${p.id}/`, { metodo: 'DELETE' });
      avisar('bien', r?.detail || 'Producto borrado.');
      setP(null);
      productos.recargar();
    } catch (err) { avisar('mal', err.message); }
  };

  return (
    <div className="pila">
      <Encabezado titulo="Carta y costeo" acciones={esAdmin && <button type="button" className="boton" onClick={() => abrir(null)}>Nuevo producto</button>}>
        Arma cada producto con lo que lleva (licores en onzas, fruta, servilleta, pincho, envío…) y te decimos cuánto cuesta hacerlo y a cuánto venderlo para ganar el margen que quieres.
      </Encabezado>
      {mensaje}
      {p && (
        <Editor p={p} setP={setP} ins={ins} esAdmin={esAdmin} margenCfg={margenCfg} redondeo={redondeo} ops={ops.datos}
          onGuardar={guardar} onBorrar={borrar} onCerrar={() => setP(null)} onInsumoNuevo={() => insumos.recargar()} avisar={avisar} />
      )}
      <section className="tarjeta">
        <h2>Productos</h2>
        {lista.length ? (
          <div className="tabla-caja" style={{ marginTop: 10 }}>
            <table>
              <thead><tr><th>Producto</th><th>Categoría</th><th className="n">Costo</th><th className="n">Precio actual</th><th className="n">Precio sugerido</th><th className="n">Margen actual</th><th /></tr></thead>
              <tbody>
                {lista.map((x) => {
                  const bajo = x.costeo.margen_actual != null && x.costeo.margen_actual < x.costeo.margen_objetivo - 0.5;
                  return (
                    <tr key={x.id} className="clic" onClick={() => abrir(x)}>
                      <td>{x.nombre}{!x.activo && <span className="etiqueta" style={{ marginLeft: 6 }}>Inactivo</span>}</td>
                      <td>{x.categoria_nombre}</td><td className="n">{pesos(x.costeo.costo)}</td><td className="n">{pesos(x.precio_venta)}</td>
                      <td className="n">{pesos(x.costeo.precio_sugerido)}</td>
                      <td className={`n ${bajo ? 'neg' : ''}`}>{pct(x.costeo.margen_actual)}</td>
                      <td>{bajo && <span className="etiqueta alerta">Bajo la meta</span>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : <p className="vacio">Aún no hay productos. {esAdmin ? 'Crea el primero con «Nuevo producto».' : ''}</p>}
      </section>
    </div>
  );
}

function Editor({ p, setP, ins, esAdmin, margenCfg, redondeo, ops, onGuardar, onBorrar, onCerrar, onInsumoNuevo, avisar }) {
  const [rapido, setRapido] = useState(null);
  const [confirmar, setConfirmar] = useState(false);
  const costo = useMemo(() => costoReceta(p.receta, ins), [p.receta, ins]);
  const margen = p.margen_objetivo === '' ? margenCfg : n(p.margen_objetivo);
  const sugerido = precioSugerido(costo, margen, redondeo);
  const real = margenReal(p.precio_venta, costo);
  const set = (k, v) => setP({ ...p, [k]: v });
  const setLinea = (i, k, v) => set('receta', p.receta.map((r, j) => (j === i ? { ...r, [k]: v } : r)));
  const usados = new Set(p.receta.map((r) => String(r.insumo)));
  const cats = ops?.categorias_insumo || [];

  const crearInsumo = async () => {
    try {
      const nuevo = await api('insumos/', { metodo: 'POST', datos: { ...rapido, costo_unitario: n(rapido.costo_unitario), controla_stock: rapido.categoria !== 'servicio' } });
      onInsumoNuevo();
      set('receta', [...p.receta, { insumo: String(nuevo.id), cantidad: '1' }]);
      setRapido(null);
    } catch (err) { avisar('mal', err.message); }
  };

  return (
    <section className="tarjeta">
      <div className="tarjeta-cabeza">
        <h2>{p.id ? p.nombre || 'Producto' : 'Nuevo producto'}</h2>
        <button type="button" className="enlace" onClick={onCerrar}>Cerrar</button>
      </div>
      <fieldset disabled={!esAdmin} style={{ border: 0, padding: 0, margin: 0 }}>
        <div className="form">
          <Campo etiqueta="Nombre" className="ancho"><input value={p.nombre} onChange={(e) => set('nombre', e.target.value)} placeholder="Ej.: Mojito, Cerveza Club Colombia" /></Campo>
          <Campo etiqueta="Categoría" className="medio">
            <select value={p.categoria} onChange={(e) => set('categoria', e.target.value)}>
              {(ops?.categorias_producto || []).map((c) => <option key={c.valor} value={c.valor}>{c.nombre}</option>)}
            </select>
          </Campo>
          <label className="check"><input type="checkbox" checked={p.activo} onChange={(e) => set('activo', e.target.checked)} /> En la carta</label>
        </div>

        <h3 style={{ margin: '18px 0 6px' }}>Qué lleva</h3>
        <div className="receta-fila" style={{ color: 'var(--tinta-suave)', fontSize: '.82rem' }}>
          <span>Insumo</span><span>Cantidad</span><span style={{ textAlign: 'right' }}>Costo</span><span />
        </div>
        {p.receta.map((r, i) => {
          const insumo = ins.find((x) => x.id === Number(r.insumo));
          return (
            <div className="receta-fila" key={i}>
              <select className="entrada" value={r.insumo} onChange={(e) => setLinea(i, 'insumo', e.target.value)}>
                <option value="">Elige un insumo</option>
                {cats.map((c) => {
                  const del = ins.filter((x) => x.categoria === c.valor && (!usados.has(String(x.id)) || String(x.id) === String(r.insumo)));
                  return del.length ? (
                    <optgroup key={c.valor} label={c.nombre}>
                      {del.map((x) => <option key={x.id} value={x.id}>{x.nombre} · {pesos(x.costo_unitario)}/{UNIDAD[x.unidad]}</option>)}
                    </optgroup>
                  ) : null;
                })}
              </select>
              <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <input className="entrada" type="number" min="0" step="0.25" value={r.cantidad} onChange={(e) => setLinea(i, 'cantidad', e.target.value)} />
                <small>{insumo ? UNIDAD[insumo.unidad] : ''}</small>
              </div>
              <strong className="num" style={{ textAlign: 'right' }}>{pesos(n(r.cantidad) * n(insumo?.costo_unitario))}</strong>
              <button type="button" className="boton peligro chico" aria-label="Quitar" onClick={() => set('receta', p.receta.filter((_, j) => j !== i))}>×</button>
            </div>
          );
        })}
        {esAdmin && (
          <div className="form" style={{ marginTop: 8 }}>
            <button type="button" className="boton secundario chico" onClick={() => set('receta', [...p.receta, { insumo: '', cantidad: '1' }])}>Agregar insumo</button>
            <button type="button" className="boton secundario chico" onClick={() => setRapido({ nombre: '', categoria: 'otro', unidad: 'unidad', costo_unitario: '' })}>Crear insumo nuevo</button>
          </div>
        )}
        {rapido && (
          <div className="tarjeta" style={{ marginTop: 10, background: '#F7F9F5' }}>
            <p style={{ marginBottom: 8 }}>Para algo sencillo: nombre, en qué se mide y cuánto cuesta cada unidad. Para botellas usa Insumos e inventario, donde puedes poner el precio de la botella y sus ml.</p>
            <div className="form">
              <Campo etiqueta="Nombre" className="ancho"><input value={rapido.nombre} onChange={(e) => setRapido({ ...rapido, nombre: e.target.value })} placeholder="Ej.: Servilleta, Envío" /></Campo>
              <Campo etiqueta="Categoría" className="medio">
                <select value={rapido.categoria} onChange={(e) => setRapido({ ...rapido, categoria: e.target.value })}>
                  {cats.map((c) => <option key={c.valor} value={c.valor}>{c.nombre}</option>)}
                </select>
              </Campo>
              <Campo etiqueta="Se mide en" className="corto">
                <select value={rapido.unidad} onChange={(e) => setRapido({ ...rapido, unidad: e.target.value })}>
                  {(ops?.unidades || []).map((u) => <option key={u.valor} value={u.valor}>{u.nombre}</option>)}
                </select>
              </Campo>
              <Campo etiqueta="Costo por unidad" className="medio"><input type="number" min="0" step="10" value={rapido.costo_unitario} onChange={(e) => setRapido({ ...rapido, costo_unitario: e.target.value })} /></Campo>
              <button type="button" className="boton chico" onClick={crearInsumo} disabled={!rapido.nombre}>Crear y agregar</button>
              <button type="button" className="enlace" onClick={() => setRapido(null)}>Cancelar</button>
            </div>
          </div>
        )}

        <div className="dos" style={{ marginTop: 18 }}>
          <div className="ticket">
            <div className="ticket-fila total"><span>Te cuesta hacerlo</span><strong>{pesos(costo)}</strong></div>
            <div className="ticket-fila">
              <span>Margen bruto que quieres</span>
              <strong>{pct(margen, 0)}{p.margen_objetivo === '' && <small style={{ fontWeight: 400 }}> (general)</small>}</strong>
            </div>
            <input type="range" min="0" max="80" step="1" value={margen} onChange={(e) => set('margen_objetivo', e.target.value)} aria-label="Margen bruto objetivo" />
            {p.margen_objetivo !== '' && <button type="button" className="enlace" onClick={() => set('margen_objetivo', '')}>Usar el margen general ({pct(margenCfg, 0)})</button>}
            <div className="ticket-fila" style={{ marginTop: 6 }}><span>Precio sugerido</span><span className="precio-grande">{pesos(sugerido)}</span></div>
            <p style={{ fontSize: '.85rem', color: 'var(--tinta-suave)' }}>
              Ganas {pesos(sugerido - costo)} por unidad. Un margen de {pct(margen, 0)} sobre el precio equivale a multiplicar el costo por {numero(1 / (1 - margen / 100), 2)}. Redondeado a múltiplos de {pesos(redondeo)}.
            </p>
          </div>
          <div className="ticket">
            <div className="form">
              <Campo etiqueta="Precio de venta en la carta" className="ancho"><input type="number" min="0" step="100" value={p.precio_venta} onChange={(e) => set('precio_venta', e.target.value)} /></Campo>
              {esAdmin && <button type="button" className="boton secundario" onClick={() => set('precio_venta', String(sugerido))}>Usar precio sugerido</button>}
            </div>
            <div className="ticket-fila" style={{ marginTop: 10 }}><span>Utilidad por unidad</span><strong className={n(p.precio_venta) - costo >= 0 ? 'pos' : 'neg'}>{pesos(n(p.precio_venta) - costo)}</strong></div>
            <div className="ticket-fila"><span>Margen real con ese precio</span><strong className={real != null && real < margen - 0.5 ? 'neg' : 'pos'}>{pct(real)}</strong></div>
            {real != null && real < margen - 0.5 && <p className="aviso mal" style={{ marginTop: 8 }}>Con este precio ganas menos del {pct(margen, 0)} que quieres.</p>}
          </div>
        </div>

        {esAdmin && (
          <div className="form" style={{ marginTop: 16 }}>
            <button type="button" className="boton" onClick={onGuardar} disabled={!p.nombre}>Guardar producto</button>
            {p.id && <button type="button" className="boton peligro" onClick={() => (confirmar ? onBorrar() : setConfirmar(true))}>{confirmar ? 'Confirmar borrado' : 'Borrar'}</button>}
          </div>
        )}
      </fieldset>
    </section>
  );
}
