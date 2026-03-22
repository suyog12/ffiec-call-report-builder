import PDFViewer from "../components/PDFViewer";

export default function PDFPage({ pdfUrl }) {
  return (
    <div>
      <h2>PDF Report</h2>
      <PDFViewer pdfUrl={pdfUrl} />
    </div>
  );
}