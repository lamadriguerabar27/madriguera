import { useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../auth.jsx';

const GRUPOS = [
  { titulo: 'Día a día', enlaces: [['/', 'Cierre del día'], ['/egresos', 'Egresos'], ['/ventas', 'Ventas por producto']] },
  { titulo: 'Análisis', enlaces: [['/flujo', 'Flujo de caja'], ['/analitica', 'Productos más vendidos'], ['/proyeccion', 'Metas y rendimiento']] },
  { titulo: 'Costos', enlaces: [['/carta', 'Carta, costos y precios'], ['/insumos', 'Insumos e inventario'], ['/facturas', 'Facturas']] },
];

export default function Layout() {
  const { usuario, esAdmin, salir } = useAuth();
  const [abierta, setAbierta] = useState(false);
  const { pathname } = useLocation();
  const grupos = esAdmin
    ? [...GRUPOS, { titulo: 'Administración', enlaces: [['/configuracion', 'Configuración'], ['/categorias', 'Categorías'], ['/usuarios', 'Usuarios']] }]
    : GRUPOS;
  const actual = grupos.flatMap((g) => g.enlaces).find(([to]) => to === pathname)?.[1] || 'La Madriguera';

  return (
    <div className="app">
      <div className="barra-movil">
        <button type="button" onClick={() => setAbierta(true)} aria-label="Abrir menú">Menú</button>
        <img src="/jaguar.webp" alt="" />
        <strong>{actual}</strong>
      </div>
      {abierta && <div className="velo" onClick={() => setAbierta(false)} />}
      <nav className={`lateral ${abierta ? 'abierta' : ''}`} aria-label="Secciones">
        <div className="marca">
          <img src="/jaguar.webp" alt="Jaguar de La Madriguera" />
          <span className="script dorado">La</span>
          <strong className="dorado">MADRIGUERA</strong>
          <small className="espaciado">Café · Bar · Bogotá</small>
        </div>
        {grupos.map((g) => (
          <div className="grupo-nav" key={g.titulo}>
            <p>{g.titulo}</p>
            {g.enlaces.map(([to, texto]) => (
              <NavLink key={to} to={to} end className={({ isActive }) => (isActive ? 'activo' : '')} onClick={() => setAbierta(false)}>
                {texto}
              </NavLink>
            ))}
          </div>
        ))}
        <div className="pie">
          <NavLink to="/perfil" onClick={() => setAbierta(false)}>{usuario?.first_name || usuario?.username}</NavLink>
          <div>{esAdmin ? 'Administrador' : 'Colaborador'} · <button type="button" onClick={salir}>Salir</button></div>
        </div>
      </nav>
      <main className="contenido">
        <Outlet />
      </main>
    </div>
  );
}
