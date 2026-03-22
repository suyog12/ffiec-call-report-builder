export default function PDFViewer({ pdfUrl }) {
  if (!pdfUrl) {
    return <p>No PDF loaded.</p>;
  }

  return (
    <iframe
      src={pdfUrl}
      title="Call Report PDF"
      width="100%"
      height="800px"
      style={{ border: "1px solid #ddd", borderRadius: "6px" }}
    />
  );
}