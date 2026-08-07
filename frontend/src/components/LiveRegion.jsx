/**
 * Regiones aria-live del flujo.
 *
 * Se renderizan siempre (no condicionalmente): un lector de pantalla sólo observa las
 * regiones live que ya existían en el DOM cuando cambia su contenido. Cada mensaje se
 * monta con su propio `key` para que un texto idéntico al anterior vuelva a anunciarse.
 */
export default function LiveRegion({ polite, assertive }) {
  return (
    <>
      <div className="visually-hidden" role="status" aria-live="polite" aria-atomic="true">
        {polite ? <span key={polite.id}>{polite.text}</span> : null}
      </div>
      <div className="visually-hidden" role="alert" aria-live="assertive" aria-atomic="true">
        {assertive ? <span key={assertive.id}>{assertive.text}</span> : null}
      </div>
    </>
  )
}
