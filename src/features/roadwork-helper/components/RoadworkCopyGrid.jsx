function formatCell(value) {
  if (value === null || value === undefined || value === '') return '-';
  return value;
}

export default function RoadworkCopyGrid({ columns, rows }) {
  return (
    <div className="roadwork-grid-shell">
      <table className="roadwork-copy-grid">
        <thead>
          <tr>
            {columns.map((col) => (
              <th key={col.key} className={col.key === 'item' ? 'text-left' : 'text-right'}>
                {col.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={columns.length} className="roadwork-grid-empty">
                선택한 날짜에 표시할 데이터가 없습니다.
              </td>
            </tr>
          ) : rows.map((row, rowIndex) => (
            <tr key={`${row.item || 'row'}-${rowIndex}`}>
              {columns.map((col) => (
                <td key={col.key} className={col.key === 'item' ? 'text-left strong' : 'text-right'}>
                  {formatCell(row[col.key])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
