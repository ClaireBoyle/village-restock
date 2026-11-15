import { Icon } from '@/components/Icon';
import { CsvImport } from '@/components/admin/CsvImport';

export default function ImportExport() {
  return (
    <>
      <div className="page-head"><div><h1>Spreadsheets</h1><p>Edit products and targets in Excel, Numbers or Google Sheets, or download records for managers.</p></div></div>

      <section className="panel" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <h2>Products and targets</h2>
        <ol className="steps-list">
          <li><b>Download</b> the current list. Each row is one product in one area.</li>
          <li><b>Edit</b> it: change targets, add rows for new products, or set Status to <i>archived</i> to take a product off the menu.</li>
          <li><b>Upload</b> it below. You&rsquo;ll see exactly what will change before anything is saved.</li>
        </ol>
        <div className="row-actions"><a className="btn" href="/api/admin/export/products" download><Icon name="down" />Download products (CSV)</a></div>
        <CsvImport />
        <details className="meta">
          <summary style={{ cursor: 'pointer' }}>Column guide</summary>
          <ul style={{ marginTop: 8, lineHeight: 1.6 }}>
            <li><b>Department, Area, Storeroom</b>: must match names already in the app (not case-sensitive).</li>
            <li><b>How restocked</b>: <i>target level</i>, <i>staff enter</i> or <i>routine task</i>.</li>
            <li><b>Target</b>: needed for target level products, e.g. 12.</li>
            <li><b>Part quantities</b>: <i>yes</i> to allow things like 0.5 kg.</li>
            <li><b>Menu items if out</b>: separate with semicolons, e.g. <i>Golden Harvest Burger; Kids Burger</i>.</li>
            <li><b>Status</b>: <i>active</i> or <i>archived</i>. Nothing is ever deleted by an import.</li>
            <li>A product in two areas has two rows; its details (unit, category, etc.) must match on both.</li>
          </ul>
        </details>
      </section>

      <section className="panel" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <h2>Records for managers</h2>
        <p className="meta">Every restock and shortage, newest first.</p>
        <div className="row-actions">
          <a className="btn" href="/api/admin/export/restocks" download><Icon name="down" />Restocks (CSV)</a>
          <a className="btn" href="/api/admin/export/shortages" download><Icon name="down" />Shortages (CSV)</a>
        </div>
      </section>
    </>
  );
}
