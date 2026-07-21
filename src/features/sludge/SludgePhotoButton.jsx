import React, { useRef } from 'react';

export default function SludgePhotoButton({
  label,
  hasPhoto,
  disabled = false,
  busy = false,
  multiple = false,
  onFile,
  onFiles,
}) {
  const ref = useRef(null);
  const isDisabled = disabled || busy;

  return (
    <div style={{ display: 'flex', alignItems: 'center' }}>
      <button
        type="button"
        disabled={isDisabled}
        onClick={() => ref.current?.click()}
        style={{
          padding: '5px 12px',
          borderRadius: 6,
          border: hasPhoto ? '1.5px solid #22c55e' : '1.5px solid #94a3b8',
          background: hasPhoto ? '#f0fdf4' : '#f8fafc',
          color: hasPhoto ? '#16a34a' : '#64748b',
          fontSize: 12,
          cursor: isDisabled ? 'not-allowed' : 'pointer',
          display: 'flex',
          alignItems: 'center',
          gap: 5,
          whiteSpace: 'nowrap',
          opacity: isDisabled ? 0.45 : 1,
        }}
      >
        <span>{busy ? '...' : hasPhoto ? <>&#10003;</> : <>&#128247;</>}</span>
        <span>{label}</span>
      </button>
      <input
        ref={ref}
        type="file"
        accept="image/*"
        multiple={multiple}
        disabled={isDisabled}
        style={{ display: 'none' }}
        onChange={(event) => {
          const files = Array.from(event.target.files || []);
          if (files.length > 0) {
            if (multiple) onFiles?.(files);
            else onFile?.(files[0]);
          }
          event.target.value = '';
        }}
      />
    </div>
  );
}
