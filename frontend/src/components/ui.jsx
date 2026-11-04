import { useEffect, useState } from 'react';

export function Encabezado({ titulo, children, acciones }) {
  return (
    <header className="encabezado">
      <div>
        <h1>{titulo}</h1>
        {children && <p>{children}</p>}
      </div>
      {acciones}
    </header>
  );
}

export function Campo({ etiqueta, className = '', children }) {
  return (
    <label className={`campo ${className}`}>
      {etiqueta}
      {children}
    </label>
  );
}

export function Cifra({ titulo, valor, nota, destacada, className = '' }) {
  return (
    <div className={`cifra ${destacada ? 'destacada' : ''}`}>
      <span>{titulo}</span>
      <strong className={className}>{valor}</strong>
      {nota && <small>{nota}</small>}
    </div>
  );
}

export function Aviso({ tipo = 'info', children }) {
  if (!children) return null;
  return <p className={`aviso ${tipo}`} role={tipo === 'mal' ? 'alert' : 'status'}>{children}</p>;
}

/** Mensaje que se borra solo a los pocos segundos (los errores se quedan). */
export function useMensaje() {
  const [m, setM] = useState(null);
  useEffect(() => {
    if (!m || m.tipo === 'mal') return undefined;
    const t = setTimeout(() => setM(null), 4000);
    return () => clearTimeout(t);
  }, [m]);
  return [m ? <Aviso tipo={m.tipo}>{m.texto}</Aviso> : null, (tipo, texto) => setM(texto ? { tipo, texto } : null)];
}

export function SelectorMes({ valor, onChange, etiqueta = 'Mes' }) {
  return (
    <Campo etiqueta={etiqueta} className="medio">
      <input type="month" value={valor} onChange={(e) => e.target.value && onChange(e.target.value)} />
    </Campo>
  );
}
