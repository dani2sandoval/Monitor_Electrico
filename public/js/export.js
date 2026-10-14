"use strict";

/**
 * Exporta el conjunto filtrado que publica HistoryView.
 * Todo se genera en el navegador: ningún registro ni secreto vuelve al servidor.
 */
class HistoryExporter {
  static PROJECT_NAME = "Monitor Inteligente de Consumo Eléctrico";

  static COLUMNS = [
    {label: "Fecha", key: "date"},
    {label: "Hora", key: "time"},
    {label: "Temperatura (°C)", key: "temperatura", decimals: 2},
    {label: "Voltaje (V)", key: "voltaje", decimals: 2},
    {label: "Corriente (A)", key: "corriente", decimals: 3},
    {label: "Potencia (W)", key: "potencia", decimals: 2},
    {label: "Energía (kWh)", key: "energia", decimals: 4},
    {label: "Costo", key: "costo", decimals: 4},
    {label: "Señal ADC", key: "senal_adc", decimals: 3, unit: "V"}
  ];

  constructor() {
    this.records = [];
    this.filters = {from: "", to: ""};
    this.buttons = [...document.querySelectorAll("[data-export]")];
    this.count = document.getElementById("exportCount");
    this.generatedAt = document.getElementById("generatedAt");
    this.feedback = document.getElementById("exportFeedback");
    this.dateFormatter = new Intl.DateTimeFormat("es-GT", {day: "2-digit", month: "2-digit", year: "numeric"});
    this.timeFormatter = new Intl.DateTimeFormat("es-GT", {hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false});
    this.dateTimeFormatter = new Intl.DateTimeFormat("es-GT", {dateStyle: "medium", timeStyle: "medium"});
    this.bindEvents();
    this.updateState();
  }

  bindEvents() {
    document.addEventListener("history:datachange", event => {
      this.records = event.detail.records;
      this.filters = event.detail.filters;
      this.updateState();
    });
    this.buttons.forEach(button => button.addEventListener("click", () => this.export(button.dataset.export, button)));
  }

  updateState() {
    this.count.textContent = this.records.length.toLocaleString("es-GT");
    this.generatedAt.textContent = this.dateTimeFormatter.format(new Date());
    this.buttons.forEach(button => { button.disabled = this.records.length === 0; });
  }

  async export(format, button) {
    if (!this.records.length) return;
    this.setBusy(button, true);
    try {
      if (format === "pdf") this.exportPdf();
      else if (format === "xlsx") await this.exportExcel();
      else if (format === "csv") this.exportCsv();
      else throw new Error("Formato de exportación no reconocido.");
      this.showFeedback(`Reporte ${format.toUpperCase()} generado correctamente.`, "success");
    } catch (error) {
      console.error("Error exportando historial:", error);
      this.showFeedback(error.message || "No fue posible generar el reporte.", "error");
    } finally {
      this.setBusy(button, false);
    }
  }

  setBusy(activeButton, busy) {
    this.buttons.forEach(button => { button.disabled = busy || this.records.length === 0; });
    activeButton.classList.toggle("busy", busy);
    if (busy) this.showFeedback("Preparando reporte…", "");
  }

  showFeedback(message, type) {
    this.feedback.textContent = message;
    this.feedback.className = `export-feedback ${type}`.trim();
  }

  reportDate() {
    return this.dateTimeFormatter.format(new Date());
  }

  filterDescription() {
    const range = this.filters.from || this.filters.to
      ? `${this.filters.from || "inicio"} — ${this.filters.to || "actualidad"}`
      : "Todos los registros";
    return range;
  }

  value(record, column, formatted = false) {
    const date = new Date(record._timestamp);
    if (column.key === "date") return formatted ? this.dateFormatter.format(date) : date;
    if (column.key === "time") return formatted ? this.timeFormatter.format(date) : date;
    const numeric = Number(record[column.key]);
    if (!Number.isFinite(numeric)) return formatted ? "—" : null;
    if (!formatted) return numeric;
    const display = numeric.toFixed(column.decimals);
    return column.unit ? `${display} ${column.unit}` : display;
  }

  exportPdf() {
    if (!window.jspdf?.jsPDF) throw new Error("El generador PDF no está disponible.");
    const {jsPDF} = window.jspdf;
    const documentPdf = new jsPDF({orientation: "landscape", unit: "mm", format: "a4", compress: true});
    if (typeof documentPdf.autoTable !== "function") throw new Error("El componente de tablas PDF no está disponible.");
    const generated = this.reportDate();
    const body = this.records.map(record => HistoryExporter.COLUMNS.map(column => this.value(record, column, true)));

    documentPdf.autoTable({
      head: [HistoryExporter.COLUMNS.map(column => column.label)],
      body,
      startY: 46,
      margin: {top: 31, right: 9, bottom: 15, left: 9},
      theme: "grid",
      styles: {font: "helvetica", fontSize: 6.4, cellPadding: 1.7, lineColor: [208, 218, 223], lineWidth: .15, textColor: [36, 48, 55], overflow: "linebreak"},
      headStyles: {fillColor: [10, 24, 34], textColor: [222, 255, 145], fontStyle: "bold", lineColor: [43, 67, 78]},
      alternateRowStyles: {fillColor: [245, 248, 249]},
      columnStyles: {0: {cellWidth: 22}, 1: {cellWidth: 19}, 2: {cellWidth: 27}, 3: {cellWidth: 23}, 4: {cellWidth: 25}, 5: {cellWidth: 25}, 6: {cellWidth: 27}, 7: {cellWidth: 22}, 8: {cellWidth: 21}},
      didDrawPage: data => {
        documentPdf.setFillColor(4, 10, 15);
        documentPdf.rect(0, 0, documentPdf.internal.pageSize.getWidth(), 25, "F");
        documentPdf.setFillColor(186, 255, 56);
        documentPdf.roundedRect(9, 6, 12, 12, 2, 2, "F");
        documentPdf.setTextColor(7, 16, 8);
        documentPdf.setFont("helvetica", "bold");
        documentPdf.setFontSize(6.5);
        documentPdf.text("V/O", 15, 13.5, {align: "center"});
        documentPdf.setTextColor(244, 247, 248);
        documentPdf.setFontSize(12);
        documentPdf.text(HistoryExporter.PROJECT_NAME, 26, 11);
        documentPdf.setTextColor(132, 148, 157);
        documentPdf.setFont("helvetica", "normal");
        documentPdf.setFontSize(7);
        documentPdf.text(`Historial de mediciones · ${this.records.length} registros`, 26, 17);
        documentPdf.text(`Generado: ${generated}`, documentPdf.internal.pageSize.getWidth() - 9, 11, {align: "right"});
        documentPdf.text(this.filterDescription(), documentPdf.internal.pageSize.getWidth() - 9, 17, {align: "right", maxWidth: 100});
        if (data.pageNumber === 1) {
          documentPdf.setTextColor(62, 77, 85);
          documentPdf.setFontSize(7);
          documentPdf.text("Reporte consolidado de telemetría energética", 9, 34);
          documentPdf.text(`Total de registros encontrados: ${this.records.length}`, 9, 39);
        }
      }
    });

    const totalPages = documentPdf.getNumberOfPages();
    for (let page = 1; page <= totalPages; page += 1) {
      documentPdf.setPage(page);
      documentPdf.setDrawColor(213, 222, 226);
      documentPdf.line(9, 198, 288, 198);
      documentPdf.setTextColor(105, 120, 128);
      documentPdf.setFontSize(6.5);
      documentPdf.text(HistoryExporter.PROJECT_NAME, 9, 203);
      documentPdf.text(`Página ${page} de ${totalPages}`, 288, 203, {align: "right"});
    }
    documentPdf.save(this.filename("pdf"));
  }

  async exportExcel() {
    if (typeof window.writeXlsxFile !== "function") throw new Error("El generador Excel no está disponible.");
    const titleCell = {value: HistoryExporter.PROJECT_NAME, span: 9, fontWeight: "bold", fontSize: 16, color: "#FFFFFF", backgroundColor: "#071018", height: 28, align: "left"};
    const metadataStyle = {fontSize: 10, color: "#41515A"};
    const headerStyle = {fontWeight: "bold", color: "#E6FFAF", backgroundColor: "#0A1822", align: "center", height: 24};
    const rows = [
      [titleCell],
      [{value: `Fecha y hora de generación: ${this.reportDate()}`, span: 9, ...metadataStyle}],
      [{value: `Total de registros encontrados: ${this.records.length}`, span: 9, ...metadataStyle}],
      [{value: `Filtros: ${this.filterDescription()}`, span: 9, ...metadataStyle}],
      [{value: "", span: 9}],
      HistoryExporter.COLUMNS.map(column => ({value: column.label, ...headerStyle})),
      ...this.records.map(record => HistoryExporter.COLUMNS.map(column => {
        const value = this.value(record, column, false);
        if (column.key === "date") return {value, type: Date, format: "dd/mm/yyyy"};
        if (column.key === "time") return {value, type: Date, format: "hh:mm:ss"};
        if (typeof value === "number") {
          const numericFormat = column.decimals ? `0.${"0".repeat(column.decimals)}` : "0";
          return {value, type: Number, format: column.unit ? `${numericFormat} "${column.unit}"` : numericFormat};
        }
        return {value: value ?? "", type: String};
      }))
    ];
    const columns = [13, 12, 18, 15, 16, 16, 17, 14, 14].map(width => ({width}));
    await window.writeXlsxFile(rows, {columns, stickyRowsCount: 6, sheet: "Historial"}).toFile(this.filename("xlsx"));
  }

  exportCsv() {
    const lines = [
      [HistoryExporter.PROJECT_NAME],
      ["Fecha y hora de generación", this.reportDate()],
      ["Total de registros encontrados", this.records.length],
      ["Filtros", this.filterDescription()],
      [],
      HistoryExporter.COLUMNS.map(column => column.label),
      ...this.records.map(record => HistoryExporter.COLUMNS.map(column => this.value(record, column, column.key === "senal_adc")))
    ];
    const csv = `\uFEFFsep=;\r\n${lines.map(row => row.map(value => this.csvCell(value)).join(";")).join("\r\n")}`;
    this.downloadBlob(new Blob([csv], {type: "text/csv;charset=utf-8"}), this.filename("csv"));
  }

  csvCell(value) {
    let text;
    if (value instanceof Date) text = this.dateTimeFormatter.format(value);
    else text = value == null ? "" : String(value);
    if (/^[=+@\t\r]/.test(text) || (/^-/.test(text) && !/^-?\d+(\.\d+)?$/.test(text))) text = `'${text}`;
    return `"${text.replace(/"/g, '""')}"`;
  }

  filename(extension) {
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    return `monitor-electrico-historial-${stamp}.${extension}`;
  }

  downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}

document.addEventListener("DOMContentLoaded", () => new HistoryExporter());
