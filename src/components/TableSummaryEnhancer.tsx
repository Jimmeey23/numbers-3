import { useEffect } from 'react';

/**
 * Adds one closed, plain-language explanation to every table in the application — including
 * tables rendered lazily and tables supplied by custom widgets. A MutationObserver is used here
 * deliberately: a sizeable part of the product is made up of small domain-specific tables and a
 * single enhancer means a newly added table cannot silently ship without an explanation.
 *
 * Components can provide richer copy with data-summary / data-calculation on `.table-scroll`.
 */
export function TableSummaryEnhancer() {
  useEffect(() => {
    let scheduled = false;
    const explain = (frame: HTMLElement) => {
      const table = frame.querySelector<HTMLTableElement>('table');
      if (!table) return;

      let id = frame.dataset.summaryId;
      if (!id) {
        id = `table-summary-${Math.random().toString(36).slice(2, 10)}`;
        frame.dataset.summaryId = id;
      }
      let details = document.querySelector<HTMLDetailsElement>(`details[data-table-summary-for="${id}"]`);
      if (!details) {
        details = document.createElement('details');
        details.className = 'table-summary';
        details.dataset.tableSummaryFor = id;
        details.innerHTML = '<summary><span class="table-summary-icon">✦</span><span>What this table says</span><span class="table-summary-meta"></span></summary><div class="table-summary-copy"></div>';
        frame.parentElement?.insertBefore(details, frame);
      }

      const heads = [...table.querySelectorAll<HTMLTableCellElement>('thead th')]
        .map((h) => h.textContent?.replace(/[▲▼]/g, '').trim() ?? '').filter(Boolean);
      const bodyRows = [...table.querySelectorAll<HTMLTableRowElement>('tbody tr')]
        .filter((r) => !r.hasAttribute('aria-hidden') && r.querySelector('td'));
      const visibleRows = bodyRows.filter((r) => getComputedStyle(r).display !== 'none').length;
      const title = frame.dataset.summaryTitle
        ?? frame.closest<HTMLElement>('.register')?.querySelector<HTMLElement>('.register-title h2')?.textContent?.trim()
        ?? frame.parentElement?.querySelector<HTMLElement>('.panel-head .t-heading-m, .t-heading-m')?.textContent?.trim()
        ?? 'this view';
      const dimensions = heads.slice(0, 2).join(' and ');
      const measures = heads.slice(2).join(', ');
      const hasRate = heads.some((h) => /rate|fill|share|margin|conversion|retention|utilisation|%/i.test(h));
      const hasAverage = heads.some((h) => /avg|average|per |median/i.test(h));
      const hasCurrency = heads.some((h) => /revenue|value|cost|paid|sales|aov|liability|impact|ltv/i.test(h));

      const plain = frame.dataset.summary || (heads.length
        ? `This table shows ${visibleRows.toLocaleString('en-IN')} visible row${visibleRows === 1 ? '' : 's'} for ${title}. `
          + `Rows are organised by ${dimensions || heads[0]}; ${measures ? `the remaining columns report ${measures}.` : 'the columns describe the records in scope.'}`
        : `This table shows ${visibleRows.toLocaleString('en-IN')} records for ${title}.`);
      const methods = frame.dataset.calculation || [
        'Only rows matching the active period, location and other dashboard filters are included.',
        hasRate ? 'Rates and percentages are recomputed from their underlying numerator and denominator at this level; percentages are never averaged.' : '',
        hasAverage ? 'Averages use contributing non-null records; medians use the middle observed value and “per” measures divide the stated totals.' : '',
        hasCurrency ? 'Money is shown in INR. Totals sum source values after exclusions such as voided or imported rows defined by the metric registry.' : '',
        'A dash means the value is not measurable for this scope, not zero. Row counts show the available sample.',
      ].filter(Boolean).join(' ');

      const meta = details.querySelector<HTMLElement>('.table-summary-meta');
      const copy = details.querySelector<HTMLElement>('.table-summary-copy');
      const metaText = `${visibleRows.toLocaleString('en-IN')} rows · ${heads.length.toLocaleString('en-IN')} columns · collapsed`;
      const copyHtml = `<p>${escapeHtml(plain)}</p><div class="table-summary-method"><b>How it is calculated</b><span>${escapeHtml(methods)}</span></div>`;
      if (meta && meta.textContent !== metaText) meta.textContent = metaText;
      if (copy && copy.innerHTML !== copyHtml) copy.innerHTML = copyHtml;
    };

    const refresh = () => {
      scheduled = false;
      document.querySelectorAll<HTMLElement>('.table-scroll').forEach(explain);
      document.querySelectorAll<HTMLDetailsElement>('details[data-table-summary-for]').forEach((d) => {
        const id = d.dataset.tableSummaryFor;
        if (id && !document.querySelector(`[data-summary-id="${id}"]`)) d.remove();
      });
    };
    const schedule = () => {
      if (scheduled) return;
      scheduled = true;
      window.requestAnimationFrame(refresh);
    };
    const observer = new MutationObserver(schedule);
    observer.observe(document.body, { childList: true, subtree: true });
    schedule();
    return () => {
      observer.disconnect();
      document.querySelectorAll('details[data-table-summary-for]').forEach((d) => d.remove());
    };
  }, []);
  return null;
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[c]!));
}
