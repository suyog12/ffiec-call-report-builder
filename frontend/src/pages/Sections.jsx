import SectionTable from "../components/SectionTable";

export default function Sections({ selectedSectionsData }) {
  return (
    <div>
      <h2>Sections</h2>

      {!selectedSectionsData || Object.keys(selectedSectionsData).length === 0 ? (
        <p>No sections selected.</p>
      ) : (
        Object.entries(selectedSectionsData).map(([sectionName, rows]) => (
          <div key={sectionName} style={{ marginBottom: "24px" }}>
            <h3>{sectionName}</h3>
            <SectionTable data={rows} />
          </div>
        ))
      )}
    </div>
  );
}