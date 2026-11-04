import { useState } from 'react';
import { api } from '../api.js';
import { Encabezado, useMensaje } from '../components/ui.jsx';
import { useApi } from '../hooks.js';

const AMBITOS = [
  ['producto', 'Productos de la carta', 'Cómo se agrupan los productos al vender y en la analítica.'],
  ['insumo', 'Insumos', 'Licores, fruta, desechables… lo que compras para preparar.'],
  ['egreso', 'Egresos', 'En qué se gasta la plata.'],
];

export default function Categorias() {
  const lista = useApi('categorias/');
  const [mensaje, avisar] = useMensaje();
  return (
    <div className="pila">
      <Encabezado titulo="Categorías">Crea, renombra o borra las categorías de productos, insumos y egresos. Si borras una que está en uso, eliges a cuál mover sus registros.</Encabezado>
      {mensaje}
      {AMBITOS.map(([ambito, titulo, ayuda]) => (
        <Seccion key={ambito} ambito={ambito} titulo={titulo} ayuda={ayuda}
          cats={(lista.datos || []).filter((c) => c.ambito === ambito)} recargar={lista.recargar} avisar={avisar} />
      ))}
    </div>
  );
}

function Seccion({ ambito, titulo, ayuda, cats, recargar, avisar }) {
  const [nueva, setNueva] = useState('');
  const [nombres, setNombres] = useState({});
  const [borrando, setBorrando] = useState(null);
  const [destino, setDestino] = useState('');

  const crear = async (e) => {
    e.preventDefault();
    try { await api('categorias/', { metodo: 'POST', datos: { ambito, nombre: nueva, orden: cats.length } }); setNueva(''); recargar(); avisar('bien', 'Categoría creada.'); } catch (err) { avisar('mal', err.message); }
  };
  const renombrar = async (c) => {
    try { await api(`categorias/${c.id}/`, { metodo: 'PATCH', datos: { nombre: nombres[c.id] } }); setNombres({ ...nombres, [c.id]: undefined }); recargar(); avisar('bien', 'Nombre actualizado.'); } catch (err) { avisar('mal', err.message); }
  };
  const borrar = async (c) => {
    if (c.en_uso && !destino) { avisar('mal', 'Elige a qué categoría mover sus registros.'); return; }
    try {
      await api(`categorias/${c.id}/${c.en_uso ? `?mover_a=${destino}` : ''}`, { metodo: 'DELETE' });
      setBorrando(null); setDestino(''); recargar(); avisar('bien', 'Categoría borrada.');
    } catch (err) { avisar('mal', err.message); }
  };

  return (
    <section className="tarjeta">
      <h2>{titulo}</h2>
      <p>{ayuda}</p>
      <div className="tabla-caja" style={{ marginTop: 10 }}>
        <table>
          <thead><tr><th>Nombre</th><th className="n">Registros</th><th /></tr></thead>
          <tbody>
            {cats.map((c) => {
              const editado = nombres[c.id] !== undefined && nombres[c.id] !== c.nombre;
              return (
                <tr key={c.id}>
                  <td><input className="entrada" value={nombres[c.id] ?? c.nombre} onChange={(e) => setNombres({ ...nombres, [c.id]: e.target.value })} /></td>
                  <td className="n">{c.en_uso}</td>
                  <td style={{ whiteSpace: 'nowrap', textAlign: 'right' }}>
                    {editado && <button type="button" className="boton chico" onClick={() => renombrar(c)} style={{ marginRight: 6 }}>Guardar</button>}
                    {borrando === c.id ? (
                      <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
                        {c.en_uso > 0 && (
                          <select className="entrada" style={{ width: 170 }} value={destino} onChange={(e) => setDestino(e.target.value)}>
                            <option value="">Mover registros a…</option>
                            {cats.filter((x) => x.id !== c.id).map((x) => <option key={x.id} value={x.id}>{x.nombre}</option>)}
                          </select>
                        )}
                        <button type="button" className="boton peligro chico" onClick={() => borrar(c)}>Confirmar</button>
                        <button type="button" className="enlace" onClick={() => { setBorrando(null); setDestino(''); }}>Cancelar</button>
                      </span>
                    ) : (
                      <button type="button" className="boton peligro chico" onClick={() => setBorrando(c.id)}>Borrar</button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <form className="form" style={{ marginTop: 12 }} onSubmit={crear}>
        <input className="entrada" style={{ maxWidth: 320 }} placeholder="Nueva categoría" value={nueva} onChange={(e) => setNueva(e.target.value)} required />
        <button className="boton secundario">Agregar</button>
      </form>
    </section>
  );
}
