import { useCallback, useEffect, useState } from 'react';
import { api } from './api.js';

/** Carga una ruta de la API y la recarga cuando cambian sus dependencias. */
export function useApi(ruta, deps = []) {
  const [datos, setDatos] = useState(null);
  const [error, setError] = useState('');
  const [cargando, setCargando] = useState(true);
  const recargar = useCallback(async () => {
    if (!ruta) return;
    setCargando(true);
    try {
      setDatos(await api(ruta));
      setError('');
    } catch (e) {
      setError(e.message);
    }
    setCargando(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ruta, ...deps]);
  useEffect(() => { recargar(); }, [recargar]);
  return { datos, error, cargando, recargar, setDatos };
}
