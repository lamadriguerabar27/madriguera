import { Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { pesos } from '../format.js';

const corto = (v) => {
  const a = Math.abs(v);
  if (a >= 1e6) return `$${(v / 1e6).toLocaleString('es-CO', { maximumFractionDigits: 1 })} M`;
  if (a >= 1e3) return `$${Math.round(v / 1e3).toLocaleString('es-CO')} mil`;
  return `$${Math.round(v)}`;
};
const tip = {
  contentStyle: { borderRadius: 8, border: '1px solid #3A3222', background: '#13151C', color: '#F1E5CE', fontSize: 13 },
  labelStyle: { color: '#E2C27E' },
  itemStyle: { color: '#F1E5CE' },
  cursor: { fill: 'rgba(199,160,90,0.08)' },
  formatter: (v) => pesos(v),
};
const ejeX = { tick: { fontSize: 12, fill: '#A99F8D' }, tickLine: false, axisLine: { stroke: '#2A2F3D' } };
const ejeY = { tick: { fontSize: 12, fill: '#A99F8D' }, tickLine: false, axisLine: false, width: 70 };

export function Barras({ datos, x, series, alto = 260, apiladas = false, horizontal = false, formato = corto }) {
  return (
    <ResponsiveContainer width="100%" height={alto}>
      <BarChart data={datos} layout={horizontal ? 'vertical' : 'horizontal'} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
        <CartesianGrid stroke="#232836" vertical={horizontal} horizontal={!horizontal} />
        {horizontal ? (
          <>
            <XAxis type="number" {...ejeX} tickFormatter={formato} />
            <YAxis type="category" dataKey={x} {...ejeY} width={130} />
          </>
        ) : (
          <>
            <XAxis dataKey={x} {...ejeX} />
            <YAxis {...ejeY} tickFormatter={formato} />
          </>
        )}
        <Tooltip {...tip} formatter={(v) => (formato === corto ? pesos(v) : formato(v))} />
        {series.length > 1 && <Legend wrapperStyle={{ fontSize: 13 }} />}
        {series.map((s) => (
          <Bar key={s.clave} dataKey={s.clave} name={s.nombre} fill={s.color} stackId={apiladas ? 'a' : undefined} radius={apiladas ? 0 : [4, 4, 0, 0]} maxBarSize={36} isAnimationActive={false} />
        ))}
      </BarChart>
    </ResponsiveContainer>
  );
}

export function Lineas({ datos, x, series, alto = 260 }) {
  return (
    <ResponsiveContainer width="100%" height={alto}>
      <LineChart data={datos} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
        <CartesianGrid stroke="#232836" vertical={false} />
        <XAxis dataKey={x} {...ejeX} />
        <YAxis {...ejeY} tickFormatter={corto} />
        <Tooltip {...tip} />
        {series.length > 1 && <Legend wrapperStyle={{ fontSize: 13 }} />}
        {series.map((s) => <Line key={s.clave} type="monotone" dataKey={s.clave} name={s.nombre} stroke={s.color} strokeWidth={2} dot={false} isAnimationActive={false} />)}
      </LineChart>
    </ResponsiveContainer>
  );
}
