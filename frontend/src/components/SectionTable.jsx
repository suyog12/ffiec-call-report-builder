export default function SectionTable({ data }) {
  if (!data || data.length === 0) {
    return <p>No data available.</p>;
  }

  return (
    <table>
      <thead>
        <tr>
          <th>Line</th>
          <th>Code</th>
          <th>Description</th>
          <th>Value</th>
        </tr>
      </thead>
      <tbody>
        {data.map((row, index) => (
          <tr key={index}>
            <td>{row.line_number}</td>
            <td>{row.item_code}</td>
            <td>{row.description}</td>
            <td style={{ textAlign: "right" }}>{row.value}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}