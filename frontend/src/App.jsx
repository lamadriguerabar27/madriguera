import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from './auth.jsx';
import Layout from './components/Layout.jsx';
import Analitica from './pages/Analitica.jsx';
import Bold from './pages/Bold.jsx';
import Liquidacion from './pages/Liquidacion.jsx';
import Personal from './pages/Personal.jsx';
import Carta from './pages/Carta.jsx';
import Categorias from './pages/Categorias.jsx';
import Cierre from './pages/Cierre.jsx';
import Configuracion from './pages/Configuracion.jsx';
import Egresos from './pages/Egresos.jsx';
import Facturas from './pages/Facturas.jsx';
import Flujo from './pages/Flujo.jsx';
import Insumos from './pages/Insumos.jsx';
import Login from './pages/Login.jsx';
import Perfil from './pages/Perfil.jsx';
import Proyeccion from './pages/Proyeccion.jsx';
import Usuarios from './pages/Usuarios.jsx';
import Ventas from './pages/Ventas.jsx';

export default function App() {
  const { usuario, cargando, esAdmin } = useAuth();
  if (cargando) return <p className="vacio" style={{ padding: 24 }}>Cargando…</p>;
  if (!usuario) return <Login />;
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Cierre />} />
        <Route path="egresos" element={<Egresos />} />
        <Route path="personal" element={<Personal />} />
        <Route path="liquidacion" element={<Liquidacion />} />
        <Route path="ventas" element={<Ventas />} />
        <Route path="flujo" element={<Flujo />} />
        <Route path="analitica" element={<Analitica />} />
        <Route path="proyeccion" element={<Proyeccion />} />
        <Route path="carta" element={<Carta />} />
        <Route path="insumos" element={<Insumos />} />
        <Route path="facturas" element={<Facturas />} />
        <Route path="perfil" element={<Perfil />} />
        {esAdmin && <Route path="configuracion" element={<Configuracion />} />}
        {esAdmin && <Route path="usuarios" element={<Usuarios />} />}
        {esAdmin && <Route path="categorias" element={<Categorias />} />}
        {esAdmin && <Route path="bold" element={<Bold />} />}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
