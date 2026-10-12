/** Logo do EscalaBus: ônibus de frente com o para-brisa em forma de calendário (o dia da escala em destaque). */
export function LogoMark({ size = 36 }: { size?: number }) {
  return <img src="/logo.svg" alt="" width={size} height={size} style={{ display: 'block', flexShrink: 0 }} />;
}

export function LogoText({ dark = true }: { dark?: boolean }) {
  return (
    <span className="logo-text">
      <span style={{ color: dark ? '#fff' : '#0f172a' }}>Escala</span><span className="logo-bus">Bus</span>
    </span>
  );
}

export function Logo({ size = 36, dark = true }: { size?: number; dark?: boolean }) {
  return <span className="logo"><LogoMark size={size} /><LogoText dark={dark} /></span>;
}
