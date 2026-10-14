"use strict";

class HistoryView {
  constructor() {
    this.records = [];
    this.filtered = [];
    this.page = 1;
    this.pageSize = 20;
    this.sort = {key: "created_at", control: "date", direction: "desc"};
    this.locale = new Intl.DateTimeFormat("es-GT", {day: "2-digit", month: "2-digit", year: "numeric"});
    this.clock = new Intl.DateTimeFormat("es-GT", {hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false});
    this.currency = new Intl.NumberFormat("es-GT", {style: "currency", currency: "USD", minimumFractionDigits: 3, maximumFractionDigits: 4});
    this.elements = this.collectElements();
    this.bindEvents();
    this.load();
  }

  collectElements() {
    const ids = ["tableBody", "dateFrom", "dateTo", "pageSize", "clearFilters", "previousPage", "nextPage", "pageLabel", "rangeLabel", "loadingState", "errorState", "emptyState", "errorMessage", "retry", "reload", "visibleCount", "totalCount", "syncState"];
    return Object.fromEntries(ids.map(id => [id, document.getElementById(id)]));
  }

  bindEvents() {
    const refresh = () => { this.page = 1; this.applyFilters(); };
    this.elements.dateFrom.addEventListener("change", refresh);
    this.elements.dateTo.addEventListener("change", refresh);
    this.elements.pageSize.addEventListener("change", () => {
      this.pageSize = Number(this.elements.pageSize.value);
      refresh();
    });
    this.elements.clearFilters.addEventListener("click", () => {
      this.elements.dateFrom.value = "";
      this.elements.dateTo.value = "";
      refresh();
    });
    this.elements.previousPage.addEventListener("click", () => this.changePage(-1));
    this.elements.nextPage.addEventListener("click", () => this.changePage(1));
    this.elements.retry.addEventListener("click", () => this.load());
    this.elements.reload.addEventListener("click", () => this.load());
    document.querySelectorAll("[data-sort]").forEach(button => button.addEventListener("click", () => this.changeSort(button.dataset.sort)));
  }

  async load() {
    this.setState("loading");
    try {
      const response = await fetch("/api/historial", {headers: {Accept: "application/json"}, cache: "no-store"});
      if (!response.ok) throw new Error(`El servidor respondió con estado ${response.status}.`);
      const payload = await response.json();
      if (!Array.isArray(payload.mediciones)) throw new Error("La respuesta del historial no tiene el formato esperado.");
      this.records = payload.mediciones.map(record => ({...record, _timestamp: Date.parse(record.created_at)}));
      this.elements.totalCount.textContent = this.records.length.toLocaleString("es-GT");
      this.page = 1;
      this.setState("ready");
      this.applyFilters();
    } catch (error) {
      this.elements.errorMessage.textContent = error.message || "Verifica la conexión e intenta nuevamente.";
      this.setState("error");
    }
  }

  setState(state) {
    this.elements.loadingState.hidden = state !== "loading";
    this.elements.errorState.hidden = state !== "error";
    this.elements.syncState.className = `sync-state ${state === "ready" ? "ready" : state === "error" ? "failed" : ""}`;
    this.elements.syncState.querySelector("b").textContent = state === "ready" ? "Sincronizado" : state === "error" ? "Error" : "Cargando";
  }

  applyFilters() {
    const from = this.elements.dateFrom.value ? new Date(`${this.elements.dateFrom.value}T00:00:00`).getTime() : -Infinity;
    const to = this.elements.dateTo.value ? new Date(`${this.elements.dateTo.value}T23:59:59.999`).getTime() : Infinity;
    this.filtered = this.records.filter(record => {
      return Number.isFinite(record._timestamp) && record._timestamp >= from && record._timestamp <= to;
    });
    this.sortRecords();
    const pages = Math.max(1, Math.ceil(this.filtered.length / this.pageSize));
    this.page = Math.min(this.page, pages);
    this.render();
  }

  changeSort(key) {
    const normalizedKey = key === "date" || key === "time" ? "created_at" : key;
    if (this.sort.key === normalizedKey && this.sort.control === key) this.sort.direction = this.sort.direction === "asc" ? "desc" : "asc";
    else this.sort = {key: normalizedKey, control: key, direction: "asc"};
    this.page = 1;
    this.applyFilters();
  }

  sortRecords() {
    const {key, direction} = this.sort;
    const factor = direction === "asc" ? 1 : -1;
    this.filtered.sort((a, b) => {
      if (key === "created_at") return (a._timestamp - b._timestamp) * factor;
      const left = a[key];
      const right = b[key];
      if (left == null && right == null) return 0;
      if (left == null) return 1;
      if (right == null) return -1;
      const numericLeft = Number(left);
      const numericRight = Number(right);
      if (Number.isFinite(numericLeft) && Number.isFinite(numericRight)) return (numericLeft - numericRight) * factor;
      return String(left).localeCompare(String(right), "es", {numeric: true, sensitivity: "base"}) * factor;
    });
  }

  changePage(delta) {
    const pages = Math.max(1, Math.ceil(this.filtered.length / this.pageSize));
    this.page = Math.min(pages, Math.max(1, this.page + delta));
    this.render();
  }

  render() {
    const total = this.filtered.length;
    const pages = Math.max(1, Math.ceil(total / this.pageSize));
    const start = total ? (this.page - 1) * this.pageSize : 0;
    const end = Math.min(start + this.pageSize, total);
    const fragment = document.createDocumentFragment();
    this.filtered.slice(start, end).forEach(record => fragment.appendChild(this.createRow(record)));
    this.elements.tableBody.replaceChildren(fragment);
    this.elements.emptyState.hidden = total !== 0 || this.elements.errorState.hidden === false;
    this.elements.visibleCount.textContent = total.toLocaleString("es-GT");
    this.elements.rangeLabel.textContent = total ? `Mostrando ${start + 1}–${end} de ${total.toLocaleString("es-GT")} registros` : "0 registros visibles";
    this.elements.pageLabel.textContent = `Página ${this.page} de ${pages}`;
    this.elements.previousPage.disabled = this.page <= 1;
    this.elements.nextPage.disabled = this.page >= pages;
    this.updateSortIndicators();
    document.dispatchEvent(new CustomEvent("history:datachange", {
      detail: {
        records: this.filtered.slice(),
        filters: {from: this.elements.dateFrom.value, to: this.elements.dateTo.value}
      }
    }));
  }

  createRow(record) {
    const row = document.createElement("tr");
    const date = new Date(record._timestamp);
    const values = [
      this.locale.format(date), this.clock.format(date), this.measurement(record.temperatura, "°C", 2),
      this.measurement(record.voltaje, "V", 2), this.measurement(record.corriente, "A", 3),
      this.measurement(record.potencia, "W", 2), this.measurement(record.energia, "kWh", 4),
      this.cost(record.costo), this.measurement(record.senal_adc, "V", 3)
    ];
    values.forEach(value => {
      const cell = document.createElement("td");
      if (value instanceof Node) cell.appendChild(value); else cell.textContent = value;
      row.appendChild(cell);
    });
    return row;
  }

  measurement(value, unit, decimals) {
    const wrapper = document.createElement("span");
    const number = Number(value);
    if (!Number.isFinite(number)) { wrapper.className = "missing"; wrapper.textContent = "—"; return wrapper; }
    wrapper.append(number.toLocaleString("es-GT", {minimumFractionDigits: decimals, maximumFractionDigits: decimals}));
    if (unit) { const label = document.createElement("span"); label.className = "unit"; label.textContent = unit; wrapper.appendChild(label); }
    return wrapper;
  }

  cost(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) return this.measurement(null, "", 0);
    return this.currency.format(number);
  }

  updateSortIndicators() {
    document.querySelectorAll("[data-sort]").forEach(button => {
      const active = button.dataset.sort === this.sort.control;
      button.classList.toggle("active", active);
      button.classList.toggle("asc", active && this.sort.direction === "asc");
      button.classList.toggle("desc", active && this.sort.direction === "desc");
      button.setAttribute("aria-sort", active ? (this.sort.direction === "asc" ? "ascending" : "descending") : "none");
    });
  }
}

document.addEventListener("DOMContentLoaded", () => new HistoryView());
