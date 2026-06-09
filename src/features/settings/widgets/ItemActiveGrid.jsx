export default function ItemActiveGrid({ items, type, isSiteSelected, onToggle }) {
  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: '1fr 1fr',
      gap: '0.75rem 0.5rem',
      padding: '0.5rem 0'
    }}>
      {items.map((item, idx) => (
        <div
          key={idx}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '0.4rem',
            cursor: (!isSiteSelected || type === 'water') ? 'not-allowed' : 'pointer',
            opacity: isSiteSelected ? 1 : 0.65
          }}
          onClick={() => {
            if (!isSiteSelected) return;
            if (type === 'water') return;
            onToggle(type, idx);
          }}
        >
          <span
            className="material-icons"
            style={{
              fontSize: '18px',
              color: item.checked ? '#1e293b' : '#cbd5e1',
              transition: 'color 0.2s'
            }}
          >
            {item.checked ? 'check_box' : 'check_box_outline_blank'}
          </span>
          <span style={{
            fontSize: '0.75rem',
            fontWeight: 700,
            color: item.checked ? '#334155' : '#94a3b8',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis'
          }}>
            {item.name}
          </span>
        </div>
      ))}
    </div>
  );
}
