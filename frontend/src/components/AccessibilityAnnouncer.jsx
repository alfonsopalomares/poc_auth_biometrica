import React from 'react'

export default function AccessibilityAnnouncer({message}){
  return (
    <div aria-live="assertive" aria-atomic="true" className="visually-hidden" role="status">
      {message}
    </div>
  )
}
