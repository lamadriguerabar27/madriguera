import { useState } from 'react';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';
import { Campo, Encabezado, useMensaje } from '../components/ui.jsx';
import { fechaCorta, hoy, n, numero, pesos, UNIDAD } from '../format.js';
import { useApi } from '../hooks.js';

const LINEA = { descripcion: '', cantidad: '1', unidad_factura: 'unidad', subtotal: '', impuesto: '0', insumo: '', contenido_por_unidad: '', unidad_contenido: '' };

function convertir(cant, de, a, mlOz) {
  if (de === a) return cant;
  const vol = { ml: 1, oz: mlOz };
  if (vol[de] && vol[a]) return (cant * vol[de]) / vol[a];
  return null;
}

export default function Facturas() {
  const { esAdmin } = useAuth();
  const lista = useApi('facturas/');
  const insumos = useApi('insumos/?activos=1');
  const cfg = useApi('configuracion/');
  const ops = useApi('opciones/costos/');
  const bols = useApi('bolsillos/');
  const [f, setF] = useState(null);
  const [archivo, setArchivo] = useState(null);
  const [subiendo, setSubiendo] = useState(false);
  const [mensaje, avisar] = useMensaje();

  const abrir = (fac) => setF(fac ? {
    ...fac,
    items: fac.items.map((i) => ({ ...i, insumo: i.insumo ? String(i.insumo) : '', contenido_por_unidad: i.contenido_por_unidad ? String(n(i.contenido_por_unidad)) : '', unidad_contenido: i.unidad_contenido || '' })),
    egreso_origen: 'cuenta', egreso_bolsillo: '', registrar: true,
  } : { proveedor: '', nit: '', numero: '', fecha: hoy(), items: [{ ...LINEA }], estado: 'borrador', registrar: true, egreso_origen: 'cuenta', egreso_bolsillo: '' });

  const leer = async () => {
    if (!archivo) return;
    setSubiendo(true);
    const fd = new FormData();
    fd.append('archivo', archivo);
    try {
      const r = await api('facturas/leer/', { metodo: 'POST', archivo: fd });
      avisar('bien', `Leímos ${r.items.length} líneas de la factura ${r.numero}. Revisa y asigna cada una a un insumo.`);
      setArchivo(null);
      lista.recargar();
      abrir(r);
    } catch (err) {
      avisar('mal', err.message);
      if (err.status === 409 && err.data?.id) {
        const previa = (lista.datos || []).find((x) => x.id === err.data.id);
        if (previa) abrir(previa);
      }
    }
    setSubiendo(false);
  };

  const cuerpo = () => ({
    proveedor: f.proveedor, nit: f.nit, numero: f.numero, fecha: f.fecha,
    items: f.items.filter((i) => i.descripcion).map((i) => ({
      ...(i.id ? { id: i.id } : {}), descripcion: i.descripcion, codigo: i.codigo || '', cantidad: n(i.cantidad), unidad_factura: i.unidad_factura || 'unidad',
      subtotal: n(i.subtotal), impuesto: n(i.impuesto), insumo: i.insumo ? Number(i.insumo) : null,
      contenido_por_unidad: i.contenido_por_unidad ? n(i.contenido_por_unidad) : null, unidad_contenido: i.unidad_contenido || '',
    })),
  });

  const guardar = async () => {
    try {
      const r = await api(f.id ? `facturas/${f.id}/` : 'facturas/', { metodo: f.id ? 'PATCH' : 'POST', datos: cuerpo() });
      lista.recargar();
      abrir(r);
      avisar('bien', 'Factura guardada. Cuando esté lista, aplícala al inventario.');
      return r;
    } catch (err) { avisar('mal', err.message); return null; }
  };

  const aplicar = async () => {
    const guardada = await guardar();
    if (!guardada) return;
    const registrar_egreso = f.registrar ? { origen: f.egreso_origen, bolsillo: f.egreso_origen === 'bolsillo' ? Number(f.egreso_bolsillo) || null : null } : null;
    try {
      const r = await api(`facturas/${guardada.id}/aplicar/`, { metodo: 'POST', datos: { registrar_egreso } });
      avisar('bien', 'Factura aplicada: el inventario y los costos se actualizaron.');
      lista.recargar();
      insumos.recargar();
      abrir(r);
    } catch (err) { avisar('mal', err.message); }
  };

  const borrar = async () => {
    try { await api(`facturas/${f.id}/`, { metodo: 'DELETE' }); setF(null); lista.recargar(); avisar('bien', 'Factura borrada.'); } catch (err) { avisar('mal', err.message); }
  };

  return (
    <div className="pila">
      <Encabezado titulo="Facturas" acciones={esAdmin && <button type="button" className="boton secundario" onClick={() => abrir(null)}>Factura manual</button>}>
        Sube la factura electrónica del proveedor (.zip o .xml del correo) y te decimos cuánto te cuesta cada unidad u onza. Si no es electrónica, regístrala a mano.
      </Encabezado>
      {esAdmin && (
        <section className="tarjeta">
          <h2>Subir factura electrónica</h2>
          <div className="form" style={{ marginTop: 10 }}>
            <input type="file" accept=".zip,.xml,application/zip,text/xml,application/xml" onChange={(e) => setArchivo(e.target.files?.[0] || null)} />
            <button type="button" className="boton" disabled={!archivo || subiendo} onClick={leer}>{subiendo ? 'Leyendo…' : 'Leer factura'}</button>
          </div>
        </section>
      )}
      {mensaje}
      {f && <Editor f={f} setF={setF} ins={insumos.datos || []} cfg={cfg.datos} ops={ops.datos} bols={bols.datos || []} esAdmin={esAdmin}
        onGuardar={guardar} onAplicar={aplicar} onBorrar={borrar} onCerrar={() => setF(null)} />}
      <section className="tarjeta">
        <h2>Facturas cargadas</h2>
        {lista.datos?.length ? (
          <div className="tabla-caja" style={{ marginTop: 10 }}>
            <table>
              <thead><tr><th>Fecha</th><th>Proveedor</th><th>Número</th><th>Tipo</th><th>Estado</th><th className="n">Total</th></tr></thead>
              <tbody>
                {lista.datos.map((x) => (
                  <tr key={x.id} className="clic" onClick={() => abrir(x)}>
                    <td>{fechaCorta(x.fecha)}</td><td>{x.proveedor || '—'}</td><td>{x.numero || '—'}</td>
                    <td>{x.tipo === 'electronica' ? 'Electrónica' : 'Manual'}</td>
                    <td>{x.estado === 'aplicada' ? <span className="etiqueta">Aplicada</span> : <span className="etiqueta aviso-e">Por revisar</span>}</td>
                    <td className="n">{pesos(x.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <p className="vacio">Aún no hay facturas.</p>}
      </section>
    </div>
  );
}

function Editor({ f, setF, ins, cfg, ops, bols, esAdmin, onGuardar, onAplicar, onBorrar, onCerrar }) {
  const editable = esAdmin && f.estado !== 'aplicada';
  const mlOz = n(cfg?.ml_por_onza || 30);
  const ivaCosto = cfg?.iva_es_costo ?? true;
  const set = (k, v) => setF({ ...f, [k]: v });
  const setItem = (i, k, v) => set('items', f.items.map((it, j) => (j === i ? { ...it, [k]: v } : it)));
  const unidades = ops?.unidades || [];
  const total = f.items.reduce((s, i) => s + n(i.subtotal) + n(i.impuesto), 0);

  return (
    <section className="tarjeta">
      <div className="tarjeta-cabeza">
        <h2>{f.id ? `Factura ${f.numero || ''}` : 'Factura manual'}</h2>
        <button type="button" className="enlace" onClick={onCerrar}>Cerrar</button>
      </div>
      <fieldset disabled={!editable} style={{ border: 0, padding: 0, margin: 0 }}>
        <div className="form">
          <Campo etiqueta="Proveedor" className="ancho"><input value={f.proveedor} onChange={(e) => set('proveedor', e.target.value)} /></Campo>
          <Campo etiqueta="NIT" className="medio"><input value={f.nit} onChange={(e) => set('nit', e.target.value)} /></Campo>
          <Campo etiqueta="Número" className="medio"><input value={f.numero} onChange={(e) => set('numero', e.target.value)} /></Campo>
          <Campo etiqueta="Fecha" className="medio"><input type="date" value={f.fecha} onChange={(e) => set('fecha', e.target.value)} /></Campo>
        </div>
        <p style={{ margin: '14px 0 8px', color: 'var(--texto-suave)' }}>
          Para cada línea elige el insumo y cuánto trae cada unidad facturada. Ej.: 1 botella trae 750 ml; 1 caja trae 24 unidades. {ivaCosto ? 'El IVA se suma al costo.' : 'El costo no incluye IVA.'}
        </p>
        <div className="tabla-caja">
          <table className="tabla-factura">
            <thead><tr><th>Producto en la factura</th><th className="n">Cant.</th><th>Unidad</th><th className="n">Valor sin IVA</th><th className="n">IVA/imp.</th><th>Insumo</th><th>Cada unidad trae</th><th className="n">Entra</th><th className="n">Costo por unidad</th>{editable && <th />}</tr></thead>
            <tbody>
              {f.items.map((it, i) => {
                const insumo = ins.find((x) => x.id === Number(it.insumo));
                const uc = it.unidad_contenido || insumo?.unidad || 'unidad';
                const porUnidad = insumo ? convertir(n(it.contenido_por_unidad || 1), uc, insumo.unidad, mlOz) : null;
                const entra = porUnidad != null ? porUnidad * n(it.cantidad) : null;
                const costoLinea = ivaCosto ? n(it.subtotal) + n(it.impuesto) : n(it.subtotal);
                const costoU = it.costo_unitario_insumo != null ? n(it.costo_unitario_insumo) : entra ? costoLinea / entra : null;
                return (
                  <tr key={it.id || `n${i}`}>
                    <td style={{ minWidth: 200 }}><input className="entrada" value={it.descripcion} onChange={(e) => setItem(i, 'descripcion', e.target.value)} /></td>
                    <td style={{ width: 80 }}><input className="entrada" type="number" min="0" step="any" value={it.cantidad} onChange={(e) => setItem(i, 'cantidad', e.target.value)} /></td>
                    <td style={{ width: 100 }}><input className="entrada" value={it.unidad_factura} onChange={(e) => setItem(i, 'unidad_factura', e.target.value)} /></td>
                    <td style={{ width: 120 }}><input className="entrada" type="number" min="0" step="any" value={it.subtotal} onChange={(e) => setItem(i, 'subtotal', e.target.value)} /></td>
                    <td style={{ width: 100 }}><input className="entrada" type="number" min="0" step="any" value={it.impuesto} onChange={(e) => setItem(i, 'impuesto', e.target.value)} /></td>
                    <td style={{ minWidth: 170 }}>
                      <select className="entrada" value={it.insumo} onChange={(e) => setItem(i, 'insumo', e.target.value)}>
                        <option value="">No va al inventario</option>
                        {ins.map((x) => <option key={x.id} value={x.id}>{x.nombre} ({UNIDAD[x.unidad]})</option>)}
                      </select>
                    </td>
                    <td style={{ minWidth: 170 }}>
                      <div style={{ display: 'flex', gap: 4 }}>
                        <input className="entrada" type="number" min="0" step="any" placeholder="1" value={it.contenido_por_unidad} onChange={(e) => setItem(i, 'contenido_por_unidad', e.target.value)} />
                        <select className="entrada" value={it.unidad_contenido || insumo?.unidad || 'unidad'} onChange={(e) => setItem(i, 'unidad_contenido', e.target.value)}>
                          {unidades.map((u) => <option key={u.valor} value={u.valor}>{UNIDAD[u.valor]}</option>)}
                        </select>
                      </div>
                    </td>
                    <td className="n">{insumo ? (entra == null ? <span className="neg">Unidad no compatible</span> : `${numero(it.cantidad_insumo ?? entra)} ${UNIDAD[insumo.unidad]}`) : '—'}</td>
                    <td className="n"><strong>{insumo && costoU ? `${pesos(costoU)}/${UNIDAD[insumo.unidad]}` : '—'}</strong></td>
                    {editable && <td><button type="button" className="boton peligro chico" aria-label="Quitar línea" onClick={() => set('items', f.items.filter((_, j) => j !== i))}>×</button></td>}
                  </tr>
                );
              })}
            </tbody>
            <tfoot><tr><td colSpan={3}>Total</td><td colSpan={2} className="n">{pesos(total)}</td><td colSpan={editable ? 5 : 4} /></tr></tfoot>
          </table>
        </div>
        {editable && <button type="button" className="boton secundario chico" style={{ marginTop: 8 }} onClick={() => set('items', [...f.items, { ...LINEA }])}>Agregar línea</button>}
      </fieldset>

      {f.estado === 'aplicada' ? (
        <p className="aviso bien" style={{ marginTop: 14 }}>
          Aplicada al inventario{f.egreso ? ` y registrada como egreso de ${pesos(f.egreso.valor)}` : ''}. Los costos de los insumos se actualizaron con promedio ponderado.
        </p>
      ) : esAdmin && (
        <div style={{ marginTop: 16, display: 'grid', gap: 10 }}>
          <div className="form">
            <label className="check"><input type="checkbox" checked={f.registrar} onChange={(e) => set('registrar', e.target.checked)} /> Registrar el pago como egreso</label>
            {f.registrar && (
              <Campo etiqueta="Se pagó desde" className="medio">
                <select value={f.egreso_origen} onChange={(e) => set('egreso_origen', e.target.value)}>
                  <option value="cuenta">Cuenta (disponible)</option><option value="caja">Caja</option><option value="bolsillo">Bolsillo</option>
                </select>
              </Campo>
            )}
            {f.registrar && f.egreso_origen === 'bolsillo' && (
              <Campo etiqueta="Bolsillo" className="medio">
                <select value={f.egreso_bolsillo} onChange={(e) => set('egreso_bolsillo', e.target.value)}>
                  <option value="">Elige uno</option>
                  {bols.filter((b) => b.activo).map((b) => <option key={b.id} value={b.id}>{b.nombre}</option>)}
                </select>
              </Campo>
            )}
          </div>
          <div className="form">
            <button type="button" className="boton secundario" onClick={onGuardar}>Guardar borrador</button>
            <button type="button" className="boton" onClick={onAplicar}>Aplicar al inventario</button>
            {f.id && <button type="button" className="boton peligro" onClick={onBorrar}>Borrar</button>}
          </div>
        </div>
      )}
    </section>
  );
}
