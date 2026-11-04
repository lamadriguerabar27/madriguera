import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { api, login as apiLogin, sesion } from './api.js';

const Ctx = createContext(null);

export function AuthProvider({ children }) {
  const [usuario, setUsuario] = useState(null);
  const [cargando, setCargando] = useState(true);

  const cargar = useCallback(async () => {
    if (!sesion.leer()) { setUsuario(null); setCargando(false); return; }
    try { setUsuario(await api('yo/')); } catch { setUsuario(null); }
    setCargando(false);
  }, []);

  useEffect(() => {
    cargar();
    const salir = () => setUsuario(null);
    window.addEventListener('sesion-cerrada', salir);
    return () => window.removeEventListener('sesion-cerrada', salir);
  }, [cargar]);

  const entrar = async (u, p) => { await apiLogin(u, p); await cargar(); };
  const salir = () => { sesion.borrar(); setUsuario(null); };

  return <Ctx.Provider value={{ usuario, cargando, entrar, salir, recargar: cargar, esAdmin: !!usuario?.es_admin }}>{children}</Ctx.Provider>;
}

export const useAuth = () => useContext(Ctx);
