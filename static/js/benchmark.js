(function () {
  const state = {
    leaderboardRows: [],
    sort: { key: "score0", direction: "desc" },
    charts: {},
    logoImages: {},
    leaderboardView: "table",
    exampleData: [],
    exampleIndex: 0,
    sqlFormatter: null,
    subtaskHidden: {
      by_method: {},
      by_setting: {}
    }
  };

  const datasetMetricLabels = {
    tables_per_db: "Tables / DB",
    columns_per_db: "Columns / DB",
    join_degree_per_db: "Join Degree / DB",
    test_queries: "Test Queries",
    tokens_per_query: "Tokens / Query",
    tables_per_query: "Tables / Query",
    joins_per_query: "Joins / Query",
    functions_per_query: "Functions / Query",
    nesting_per_query: "Nesting / Query",
    cte_per_query: "CTE / Query",
    annotated_subtasks: "Annotated Subtasks"
  };

  const colors = ["#3273dc", "#23d160", "#ff3860", "#ffdd57", "#00d1b2", "#7957d5", "#ff8c42", "#48c774"];
  const radarMethodColors = ["#E46AA3", "#7E83FF", "#F07A7A", "#58D68D"];
  const radarSettingColors = ["#E46AA3", "#7E83FF", "#F07A7A"];
  const LOGO_MARKER_SIZE = 20;

  // Optional per-method metadata. `logo` is an org logo shown next to the method name and
  // used as the scatter marker; `url` links the method name in the table; `hideInScatter`
  // leaves the method out of the scatter unless it is selected in the Method filter.
  const methodInfo = {
    "NVIDIA Auto-Ontology": {
      logo: "static/images/nvidia.webp",
      url: "https://github.com/NVIDIA/auto-ontology"
    },
    "ReFoRCE": {
      url: "https://github.com/Snowflake-Labs/ReFoRCE/tree/main/methods/ReFoRCE"
    },
    "DIN-SQL": {
      url: "https://github.com/xlang-ai/Spider2/tree/main/spider2-lite/baselines/dinsql",
      hideInScatter: true
    },
    "DAIL-SQL": {
      url: "https://github.com/xlang-ai/Spider2/tree/main/spider2-lite/baselines/dailsql",
      hideInScatter: true
    }
  };

  // Matched by model-name prefix.
  const modelLogos = [
    ["Claude", "static/images/claude.webp"],
    ["GPT", "static/images/openai.webp"],
    ["Gemini", "static/images/gemini.webp"],
    ["Qwen", "static/images/qwen.png"],
    ["MiniMax", "static/images/minimax.jpeg"],
    ["Nemotron", "static/images/nvidia.webp"]
  ];
  const defaultLogo = "static/images/beaver.png";

  const scoreSortKeys = ["score0", "score1", "score2"];
  const numericSortKeys = [...scoreSortKeys, "rank"];

  const exampleCategoryLabels = {
    "filtered_chain_without_domain.json": "Complex query",
    "filtered_tree_with_domain.json": "Domain-specific query",
    "filtered_tree_chain_with_domain.json": "Domain-specific complex query",
    "filtered_chain_tree_with_domain.json": "Domain-specific complex query"
  };

  const categoryMetrics = [
    ["complex_queries", "Complex"],
    ["domain_specific_queries", "Domain-Specific"],
    ["domain_specific_complex_queries", "Domain+Complex"],
    ["synthetic_overall", "Synthetic Overall"],
    ["real_overall", "Real Overall"]
  ];

  // Submission dates are ISO (YYYY-MM-DD) and handled in UTC so they don't shift with the viewer's timezone.
  const dayFormat = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
  const monthFormat = new Intl.DateTimeFormat("en-US", { month: "short", year: "numeric", timeZone: "UTC" });
  const listFormat = new Intl.ListFormat("en", { type: "conjunction" });

  const leaderboardLogoOverlayPlugin = {
    id: "leaderboardLogoOverlay",
    afterDatasetsDraw: function (chart) {
      if (!chart || chart.canvas.id !== "leaderboard-scatter-chart") return;
      const dataset = chart.data.datasets[0];
      if (!dataset || !dataset.data) return;

      const meta = chart.getDatasetMeta(0);
      const ctx = chart.ctx;
      const half = LOGO_MARKER_SIZE / 2;

      meta.data.forEach((point, index) => {
        const row = dataset.data[index];
        if (!row || !row.logo) return;

        const img = getLogoImage(row.logo);
        if (!img || !img.complete || !img.naturalWidth || !img.naturalHeight) return;

        const x = point.x;
        const y = point.y;

        ctx.save();
        ctx.beginPath();
        ctx.arc(x, y, half, 0, Math.PI * 2);
        ctx.closePath();
        ctx.clip();
        ctx.drawImage(img, x - half, y - half, LOGO_MARKER_SIZE, LOGO_MARKER_SIZE);
        ctx.restore();

        ctx.save();
        ctx.beginPath();
        ctx.arc(x, y, half, 0, Math.PI * 2);
        ctx.lineWidth = 1;
        ctx.strokeStyle = "#ffffff";
        ctx.stroke();
        ctx.restore();
      });
    }
  };

  // Nudges scatter logos sideways so markers that would overlap sit side by side. Runs after every
  // layout (including resizes) and moves the points themselves, so tooltips follow the logos.
  const leaderboardSpreadPlugin = {
    id: "leaderboardSpread",
    afterDatasetsUpdate: function (chart) {
      const points = chart.getDatasetMeta(0).data;
      const step = LOGO_MARKER_SIZE + 2;
      const left = chart.chartArea.left + LOGO_MARKER_SIZE / 2;
      const right = chart.chartArea.right - LOGO_MARKER_SIZE / 2;
      const placed = [];

      // Left to right, and top (highest score) to bottom within the same date. Candidate positions
      // alternate right/left of the true date and must stay inside the plot area.
      [...points].sort((a, b) => a.x - b.x || a.y - b.y).forEach((point) => {
        const baseX = point.x;
        let x = baseX;
        for (let k = 0; k < 100; k++) {
          const candidate = baseX + Math.ceil(k / 2) * step * (k % 2 ? 1 : -1);
          if (candidate < left || candidate > right) continue;
          if (!placed.some((p) => Math.abs(p.x - candidate) < step && Math.abs(p.y - point.y) < step)) {
            x = candidate;
            break;
          }
        }
        point.x = x;
        placed.push({ x, y: point.y });
      });
    }
  };

  function createOption(value, text) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = text;
    return option;
  }

  function fillChangelog(changelog) {
    const logBody = document.getElementById("changelog-body");
    if (!logBody) return;

    logBody.innerHTML = "";
    changelog.forEach((entry) => {
      const div = document.createElement("div");
      div.classList.add("box", "content", "mt-1", "mb-1", "p-3");

      const h2 = document.createElement("h2");
      h2.classList.add("title", "is-5");
      h2.innerHTML = `Update ${entry.number}<span class="tag is-info ml-2">${entry.date}</span>`;
      div.appendChild(h2);

      ["new", "improvements", "notes"].forEach((key) => {
        if (!entry[key]) return;

        const label = document.createElement("p");
        if (key === "new") label.innerHTML = "<strong>✨ New:</strong>";
        if (key === "improvements") label.innerHTML = "<strong>⚡ Improvements:</strong>";
        if (key === "notes") label.innerHTML = "<strong>📝 Notes:</strong>";
        div.appendChild(label);

        const ul = document.createElement("ul");
        entry[key].forEach((item) => {
          const li = document.createElement("li");
          li.innerHTML = item;
          ul.appendChild(li);
        });
        div.appendChild(ul);
      });

      logBody.appendChild(div);
    });
  }

  function formatJoinKey(joinKeyPair) {
    if (!Array.isArray(joinKeyPair)) return String(joinKeyPair);
    return joinKeyPair.join(" = ");
  }

  function appendEmptyListMessage(container, tagName, message) {
    const item = document.createElement(tagName);
    item.textContent = message;
    container.appendChild(item);
  }

  async function loadSqlFormatter() {
    try {
      const module = await import("https://cdn.jsdelivr.net/npm/sql-formatter@15.6.10/+esm");
      state.sqlFormatter = (
        (module && typeof module.format === "function" && module.format) ||
        (module && module.default && typeof module.default.format === "function" && module.default.format) ||
        null
      );
    } catch (error) {
      console.warn("Falling back to built-in SQL formatting:", error);
      state.sqlFormatter = null;
    }
  }

  function getExampleCategoryLabel(sourceFile) {
    return exampleCategoryLabels[sourceFile] || sourceFile || "example";
  }

  function formatExampleSqlFallback(sql) {
    if (!sql) return "";

    const normalized = sql.replace(/\s+/g, " ").trim();
    const replacements = [
      [/\bWITH\b/gi, "\nWITH"],
      [/\bSELECT\b/gi, "\nSELECT"],
      [/\bFROM\b/gi, "\nFROM"],
      [/\bWHERE\b/gi, "\nWHERE"],
      [/\bGROUP BY\b/gi, "\nGROUP BY"],
      [/\bORDER BY\b/gi, "\nORDER BY"],
      [/\bHAVING\b/gi, "\nHAVING"],
      [/\bLIMIT\b/gi, "\nLIMIT"],
      [/\bUNION ALL\b/gi, "\nUNION ALL"],
      [/\bUNION\b/gi, "\nUNION"],
      [/\bINNER JOIN\b/gi, "\n  INNER JOIN"],
      [/\bLEFT JOIN\b/gi, "\n  LEFT JOIN"],
      [/\bRIGHT JOIN\b/gi, "\n  RIGHT JOIN"],
      [/\bFULL JOIN\b/gi, "\n  FULL JOIN"],
      [/\bCROSS JOIN\b/gi, "\n  CROSS JOIN"],
      [/\bJOIN\b/gi, "\n  JOIN"],
      [/\bON\b/gi, "\n    ON"],
      [/\bAND\b/gi, "\n    AND"],
      [/\bOR\b/gi, "\n    OR"]
    ];

    const formatted = replacements.reduce(function (value, replacement) {
      return value.replace(replacement[0], replacement[1]);
    }, normalized);

    return formatted.replace(/^\s*\n/, "").trim();
  }

  function formatExampleSql(sql) {
    if (!sql) return "";

    if (typeof state.sqlFormatter === "function") {
      try {
        return state.sqlFormatter(sql, {
          language: "mysql",
          tabWidth: 2,
          keywordCase: "upper",
          linesBetweenQueries: 1
        });
      } catch (error) {
        console.warn("sql-formatter failed, using fallback formatter:", error);
      }
    }

    return formatExampleSqlFallback(sql);
  }

  function renderExample(example) {
    if (!example) return;

    document.getElementById("example-db-id").textContent = `DB: ${example.db_id || "unknown"}`;
    document.getElementById("example-source-file").textContent = getExampleCategoryLabel(example.source_file);
    document.getElementById("example-question").textContent = example.question || "";
    document.getElementById("example-sql").textContent = formatExampleSql(example.sql);

    const goldTables = document.getElementById("example-gold-tables");
    goldTables.innerHTML = "";
    (example.gold_tables || []).forEach((tableName) => {
      const chip = document.createElement("span");
      chip.className = "example-chip";
      chip.textContent = tableName;
      goldTables.appendChild(chip);
    });

    const joinKeys = document.getElementById("example-join-keys");
    joinKeys.innerHTML = "";
    (example.join_keys || []).forEach((joinKeyPair) => {
      const chip = document.createElement("span");
      chip.className = "example-chip";
      chip.textContent = formatJoinKey(joinKeyPair);
      joinKeys.appendChild(chip);
    });

    const mapping = document.getElementById("example-mapping");
    mapping.innerHTML = "";
    const mappingEntries = Object.entries(example.mapping || {});
    if (mappingEntries.length === 0) {
      const empty = document.createElement("p");
      empty.textContent = "No column mapping annotations available for this example.";
      mapping.appendChild(empty);
    } else {
      mappingEntries.forEach(function (entry) {
        const [phrase, columns] = entry;
        const item = document.createElement("div");
        item.className = "example-mapping-item";

        const key = document.createElement("div");
        key.className = "example-mapping-key";
        key.textContent = `"${phrase}"`;
        item.appendChild(key);

        const values = document.createElement("div");
        values.className = "example-mapping-values";
        (columns || []).forEach(function (columnName) {
          const value = document.createElement("span");
          value.className = "example-mapping-value";
          value.textContent = columnName;
          values.appendChild(value);
        });

        if (!values.childNodes.length) {
          const value = document.createElement("span");
          value.className = "example-mapping-value";
          value.textContent = "No mapped columns";
          values.appendChild(value);
        }

        item.appendChild(values);
        mapping.appendChild(item);
      });
    }

    const subqueries = document.getElementById("example-subqueries");
    subqueries.innerHTML = "";
    const subqueryQuestions = example.subquery_gold_questions || [];
    const subqueryQueries = example.subquery_gold_queries || [];
    const subqueryCount = Math.max(subqueryQuestions.length, subqueryQueries.length);
    if (subqueryCount === 0) {
      const empty = document.createElement("p");
      empty.textContent = "No subquery decomposition annotations available for this example.";
      subqueries.appendChild(empty);
    } else {
      for (let index = 0; index < subqueryCount; index += 1) {
        const item = document.createElement("div");
        item.className = "example-subquery-item";

        const questionKey = document.createElement("div");
        questionKey.className = "example-subquery-key";
        questionKey.textContent = `Subquery ${index+1}`;
        item.appendChild(questionKey);

        const questionValue = document.createElement("p");
        questionValue.className = "example-subquery-value";
        questionValue.textContent = subqueryQuestions[index] || "No subquery question";
        item.appendChild(questionValue);

        const sqlKey = document.createElement("div");
        sqlKey.className = "example-subquery-key";
        sqlKey.textContent = `Sub-SQL ${index+1}`;
        item.appendChild(sqlKey);

        const sqlValue = document.createElement("pre");
        sqlValue.className = "example-subquery-sql";
        sqlValue.textContent = formatExampleSql(subqueryQueries[index] || "No subquery SQL");
        item.appendChild(sqlValue);

        subqueries.appendChild(item);
      }
    }

    const evidenceList = document.getElementById("example-evidence");
    evidenceList.innerHTML = "";
    const evidence = []
      .concat(example.internal_evidence || [])
      .concat(example.external_evidence || []);

    if (evidence.length === 0) {
      appendEmptyListMessage(
        evidenceList,
        "li",
        "No evidence annotations available for this example."
      );
    } else {
      evidence.forEach((entry) => {
        const item = document.createElement("li");
        item.textContent = entry;
        evidenceList.appendChild(item);
      });
    }
  }

  function renderCurrentExample() {
    const select = document.getElementById("example-select");
    if (select) {
      select.value = String(state.exampleIndex);
    }
    renderExample(state.exampleData[state.exampleIndex]);
  }

  function bindExampleBrowser(examples) {
    if (!examples || examples.length === 0) return;

    state.exampleData = examples;
    state.exampleIndex = 0;

    const select = document.getElementById("example-select");
    const prev = document.getElementById("example-prev");
    const next = document.getElementById("example-next");
    select.innerHTML = "";

    state.exampleData.forEach(function (_, index) {
      select.appendChild(createOption(String(index), `Task ${index}`));
    });

    select.addEventListener("change", function () {
      state.exampleIndex = Number(select.value);
      renderCurrentExample();
    });

    prev.addEventListener("click", function () {
      state.exampleIndex = (state.exampleIndex - 1 + state.exampleData.length) % state.exampleData.length;
      renderCurrentExample();
    });

    next.addEventListener("click", function () {
      state.exampleIndex = (state.exampleIndex + 1) % state.exampleData.length;
      renderCurrentExample();
    });

    select.value = String(state.exampleIndex);
    renderCurrentExample();
  }

  function logoPathForModel(model) {
    const match = modelLogos.find(([prefix]) => model.startsWith(prefix));
    return match ? match[1] : defaultLogo;
  }

  function logoLabel(text, logo) {
    return `<span class="logo-label"><img src="${logo}" alt="${text} logo" onerror="this.src='${defaultLogo}'" /><span>${text}</span></span>`;
  }

  function getLogoImage(path) {
    if (state.logoImages[path]) return state.logoImages[path];

    const img = new Image();
    img.src = path;
    img.onload = function () {
      if (state.charts.leaderboardScatter) state.charts.leaderboardScatter.update();
    };

    state.logoImages[path] = img;
    return img;
  }

  function preloadAllLogos(rows) {
    const paths = [...new Set(rows.flatMap((row) => [row.modelLogo, row.methodLogo]).filter(Boolean))];
    const loads = paths.map((path) => new Promise((resolve) => {
      const img = getLogoImage(path);
      if (img.complete) {
        resolve();
        return;
      }
      img.onload = function () {
        if (state.charts.leaderboardScatter) state.charts.leaderboardScatter.update();
        resolve();
      };
      img.onerror = function () {
        resolve();
      };
    }));

    return Promise.all(loads);
  }

  function isScore(value) {
    return typeof value === "number";
  }

  function parseIsoDate(value) {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value || "");
    return match ? Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])) : null;
  }

  // Missing values always sort last, regardless of direction.
  function compareNullsLast(a, b, order) {
    const aMissing = !isScore(a);
    const bMissing = !isScore(b);
    if (aMissing || bMissing) return aMissing - bMissing;
    return (a - b) * order;
  }

  // Ranks are based on Setting 0; rows without a Setting 0 score are unranked.
  function addLeaderboardRanks(rows) {
    const sorted = rows.filter((row) => isScore(row.score0)).sort((a, b) => {
      if (b.score0 !== a.score0) return b.score0 - a.score0;
      const methodCmp = a.method.localeCompare(b.method);
      if (methodCmp !== 0) return methodCmp;
      return a.model.localeCompare(b.model);
    });

    const rankMap = {};
    sorted.forEach((row, index) => {
      rankMap[`${row.method}__${row.model}`] = index + 1;
    });

    return rows.map((row) => ({
      ...row,
      rank: rankMap[`${row.method}__${row.model}`] ?? null
    }));
  }

  function toLeaderboardRows(leaderboardData) {
    const rows = leaderboardData.entries
      .filter((entry) => (entry.scores || []).some(isScore))
      .map((entry) => {
        const scores = (entry.scores || []).map((v) => (isScore(v) ? v : null));
        const submissionTs = parseIsoDate(entry.submission_date);
        return {
          method: entry.method,
          model: entry.model,
          score0: scores[0] ?? null,
          score1: scores[1] ?? null,
          score2: scores[2] ?? null,
          submission_ts: submissionTs,
          submission_date: submissionTs !== null ? dayFormat.format(submissionTs) : "Unknown",
          methodLogo: methodInfo[entry.method]?.logo || null,
          methodUrl: methodInfo[entry.method]?.url || null,
          modelLogo: logoPathForModel(entry.model)
        };
      });

    return addLeaderboardRanks(rows);
  }

  function setupLeaderboardFilters(rows) {
    const methods = [...new Set(rows.map((r) => r.method))];
    const models = [...new Set(rows.map((r) => r.model))];

    const methodSelect = document.getElementById("method-filter");
    const modelSelect = document.getElementById("model-filter");

    methodSelect.innerHTML = "";
    modelSelect.innerHTML = "";

    methodSelect.appendChild(createOption("ALL", "All"));
    modelSelect.appendChild(createOption("ALL", "All"));

    methods.forEach((v) => methodSelect.appendChild(createOption(v, v)));
    models.forEach((v) => modelSelect.appendChild(createOption(v, v)));
  }

  function setLeaderboardView(view) {
    state.leaderboardView = view;

    const tableView = document.getElementById("leaderboard-table-view");
    const scatterView = document.getElementById("leaderboard-scatter-view");
    const tableBtn = document.getElementById("table-view-btn");
    const scatterBtn = document.getElementById("scatter-view-btn");

    if (view === "scatter") {
      tableView.classList.add("is-hidden");
      scatterView.classList.remove("is-hidden");
      tableBtn.classList.remove("is-dark");
      tableBtn.classList.add("is-light");
      scatterBtn.classList.remove("is-light");
      scatterBtn.classList.add("is-dark");
    } else {
      scatterView.classList.add("is-hidden");
      tableView.classList.remove("is-hidden");
      scatterBtn.classList.remove("is-dark");
      scatterBtn.classList.add("is-light");
      tableBtn.classList.remove("is-light");
      tableBtn.classList.add("is-dark");
    }
  }

  // Step line through the dates where the best Setting 0 score improved, extended to the latest date.
  function bestSoFar(points) {
    const sorted = [...points].sort((a, b) => a.x - b.x);
    const line = [];
    let best = -Infinity;
    sorted.forEach((p) => {
      if (p.y <= best) return;
      best = p.y;
      const last = line[line.length - 1];
      if (last && last.x === p.x) last.y = best;
      else line.push({ x: p.x, y: best });
    });

    const latest = sorted[sorted.length - 1].x;
    if (line[line.length - 1].x < latest) line.push({ x: latest, y: best });
    return line;
  }

  // Month boundaries covering [minTs, maxTs], thinned so there are at most ~12 labels.
  function monthTicks(minTs, maxTs) {
    const start = new Date(minTs);
    const months = [];
    for (let m = start.getUTCMonth(); Date.UTC(start.getUTCFullYear(), m, 1) <= maxTs; m++) {
      months.push(Date.UTC(start.getUTCFullYear(), m, 1));
    }
    const interval = [1, 2, 3, 6, 12].find((n) => months.length / n <= 12) || 12;
    return months.filter((_, i) => i % interval === 0);
  }

  function renderLeaderboardScatter(rows) {
    if (state.charts.leaderboardScatter) state.charts.leaderboardScatter.destroy();
    state.charts.leaderboardScatter = null;

    const points = rows
      .filter((row) => isScore(row.score0) && row.submission_ts !== null)
      .map((row) => ({
        x: row.submission_ts,
        y: row.score0,
        rank: row.rank,
        method: row.method,
        model: row.model,
        submission_date: row.submission_date,
        logo: row.methodLogo || row.modelLogo
      }));
    if (!points.length) return;

    const xValues = points.map((p) => p.x);
    const yValues = points.map((p) => p.y);
    const first = new Date(Math.min.apply(null, xValues));
    const last = new Date(Math.max.apply(null, xValues));
    const xMin = Date.UTC(first.getUTCFullYear(), first.getUTCMonth(), 1);
    const xMax = Date.UTC(last.getUTCFullYear(), last.getUTCMonth() + 1, 1);
    const ticks = monthTicks(xMin, xMax);
    const yMin = Math.min.apply(null, yValues);
    const yMax = Math.max.apply(null, yValues);

    state.charts.leaderboardScatter = new Chart(document.getElementById("leaderboard-scatter-chart"), {
      type: "scatter",
      data: {
        datasets: [{
          label: "Leaderboard",
          data: points,
          pointStyle: "circle",
          pointRadius: 0,
          pointHoverRadius: 0,
          pointHitRadius: 14,
          showLine: false
        }, {
          label: "Best so far",
          data: bestSoFar(points),
          showLine: true,
          stepped: "before",
          borderColor: "#b5b5b5",
          borderWidth: 1.5,
          borderDash: [4, 4],
          pointRadius: 0,
          pointHoverRadius: 0,
          pointHitRadius: 0
        }]
      },
      plugins: [leaderboardSpreadPlugin, leaderboardLogoOverlayPlugin],
      options: {
        responsive: true,
        maintainAspectRatio: false,
        // The spread plugin moves points after layout; animations would overwrite those positions.
        animation: false,
        plugins: {
          legend: {
            labels: { filter: (item) => item.datasetIndex === 1 }
          },
          tooltip: {
            filter: (item) => item.datasetIndex === 0,
            callbacks: {
              label: function (context) {
                const raw = context.raw;
                return `${raw.method} · ${raw.model} · Rank ${raw.rank} · ${raw.submission_date} · ${raw.y.toFixed(1)}`;
              }
            }
          }
        },
        scales: {
          x: {
            type: "linear",
            title: { display: true, text: "Submission Date" },
            min: xMin,
            max: xMax,
            afterBuildTicks: (axis) => {
              axis.ticks = ticks.map((value) => ({ value }));
            },
            ticks: { callback: (value) => monthFormat.format(value) }
          },
          y: {
            title: { display: true, text: "Execution Accuracy (Setting 0)" },
            min: Math.floor(yMin - 1),
            max: Math.ceil(yMax + 1)
          }
        }
      }
    });
  }

  function renderLeaderboard() {
    const tbody = document.getElementById("leaderboard-body");
    if (!tbody) return;

    const methodValue = document.getElementById("method-filter").value;
    const modelValue = document.getElementById("model-filter").value;
    const searchValue = document.getElementById("search-filter").value.trim().toLowerCase();

    const filtered = state.leaderboardRows.filter((row) => {
      const passMethod = methodValue === "ALL" || row.method === methodValue;
      const passModel = modelValue === "ALL" || row.model === modelValue;
      const passSearch = !searchValue || `${row.method} ${row.model}`.toLowerCase().includes(searchValue);
      return passMethod && passModel && passSearch;
    });

    const { key, direction } = state.sort;
    const order = direction === "asc" ? 1 : -1;
    filtered.sort((a, b) => {
      const cmp = numericSortKeys.includes(key)
        ? compareNullsLast(a[key], b[key], order)
        : a[key].localeCompare(b[key]) * order;
      return cmp || compareNullsLast(a.rank, b.rank, 1);
    });

    const fmt = (v) => (isScore(v) ? v.toFixed(1) : "-");
    tbody.innerHTML = "";
    filtered.forEach((row) => {
      const tr = document.createElement("tr");
      const methodLabel = row.methodLogo ? logoLabel(row.method, row.methodLogo) : row.method;
      const methodCell = row.methodUrl ? `<a class="method-link" href="${row.methodUrl}">${methodLabel}</a>` : methodLabel;
      tr.innerHTML = `<td class="rank-cell"><div class="rank-number">${row.rank ?? "-"}</div></td><td><span class="date-pill">${row.submission_date}</span></td><td>${methodCell}</td><td>${logoLabel(row.model, row.modelLogo)}</td><td>${fmt(row.score0)}</td><td>${fmt(row.score1)}</td><td>${fmt(row.score2)}</td>`;
      tbody.appendChild(tr);
    });

    // Methods flagged hideInScatter are left out of the scatter unless explicitly selected.
    const hiddenMethods = methodValue === "ALL"
      ? [...new Set(filtered.map((row) => row.method))].filter((method) => methodInfo[method]?.hideInScatter)
      : [];
    const scatterNote = document.getElementById("scatter-note");
    scatterNote.classList.toggle("is-hidden", hiddenMethods.length === 0);
    scatterNote.textContent = `Note: ${listFormat.format(hiddenMethods)} ${hiddenMethods.length === 1 ? "is" : "are"} shown in the table view only.`;
    renderLeaderboardScatter(filtered.filter((row) => !hiddenMethods.includes(row.method)));
  }

  function bindLeaderboardEvents() {
    ["method-filter", "model-filter"].forEach((id) => {
      document.getElementById(id).addEventListener("change", renderLeaderboard);
    });
    document.getElementById("search-filter").addEventListener("input", renderLeaderboard);

    document.querySelectorAll("th.sortable").forEach((th) => {
      th.addEventListener("click", function () {
        const key = this.getAttribute("data-sort-key");
        if (state.sort.key === key) {
          state.sort.direction = state.sort.direction === "asc" ? "desc" : "asc";
        } else {
          state.sort.key = key;
          state.sort.direction = scoreSortKeys.includes(key) ? "desc" : "asc";
        }
        renderLeaderboard();
      });
    });

    document.getElementById("table-view-btn").addEventListener("click", function () {
      setLeaderboardView("table");
    });
    document.getElementById("scatter-view-btn").addEventListener("click", function () {
      setLeaderboardView("scatter");
    });
  }

  function renderDatasetChart(datasetStats) {
    const metricSelect = document.getElementById("dataset-metric");
    metricSelect.innerHTML = "";

    Object.keys(datasetMetricLabels).forEach((key) => {
      metricSelect.appendChild(createOption(key, datasetMetricLabels[key]));
    });

    function draw() {
      const metric = metricSelect.value;
      const labels = datasetStats.datasets.map((d) => d.dataset);
      const values = datasetStats.datasets.map((d) => d[metric]);

      if (state.charts.dataset) state.charts.dataset.destroy();
      state.charts.dataset = new Chart(document.getElementById("dataset-chart"), {
        type: "bar",
        data: {
          labels,
          datasets: [{ label: datasetMetricLabels[metric], data: values, backgroundColor: colors }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: { legend: { display: false } },
          scales: { y: { beginAtZero: true } }
        }
      });
    }

    metricSelect.addEventListener("change", draw);
    draw();
  }

  function renderCategoryChart(categoryData) {
    const labels = categoryData.methods.map((m) => m.method);
    const datasets = categoryMetrics.map((metric, idx) => ({
      label: metric[1],
      data: categoryData.methods.map((m) => m[metric[0]]),
      backgroundColor: colors[idx % colors.length]
    }));

    if (state.charts.category) state.charts.category.destroy();
    state.charts.category = new Chart(document.getElementById("category-chart"), {
      type: "bar",
      data: { labels, datasets },
      options: { responsive: true, maintainAspectRatio: false, scales: { y: { beginAtZero: true } } }
    });
  }

  function renderSettingsList(settingsData) {
    const list = document.getElementById("settings-list");
    list.innerHTML = "";
    settingsData.settings.forEach((setting) => {
      const item = document.createElement("li");
      const label = document.createElement("strong");
      label.textContent = `${setting.label}:`;
      item.appendChild(label);
      item.appendChild(document.createTextNode(` ${setting.description}`));
      list.appendChild(item);
    });
  }

  function renderSubtaskChart(subtaskRadarData, settingsData) {
    const settingDescriptions = Object.fromEntries(
      settingsData.settings.map((setting) => [setting.id, setting.description])
    );
    const settingSelect = document.getElementById("subtask-setting");
    const methodSelect = document.getElementById("subtask-method");
    const settingControl = document.getElementById("subtask-setting-control");
    const methodControl = document.getElementById("subtask-method-control");
    const legend = document.getElementById("subtask-legend");
    const bySettingBtn = document.getElementById("subtask-view-setting-btn");
    const byMethodBtn = document.getElementById("subtask-view-method-btn");
    let viewMode = "by_method";

    settingSelect.innerHTML = "";
    methodSelect.innerHTML = "";

    subtaskRadarData.settings.forEach((setting) => {
      settingSelect.appendChild(
        createOption(setting.id, `${setting.label}: ${settingDescriptions[setting.id]}`)
      );
    });
    subtaskRadarData.settings[0].methods.forEach((methodEntry) => {
      methodSelect.appendChild(createOption(methodEntry.method, methodEntry.method));
    });

    const axisKeys = subtaskRadarData.axes.map((axis) => axis.key);
    const axisLabels = subtaskRadarData.axes.map((axis) => axis.label);

    function renderSubtaskLegend(items, chartDatasets) {
      legend.innerHTML = "";
      items.forEach(function (item) {
        const node = document.createElement("div");
        node.className = "subtask-legend-item";
        if (item.hidden) {
          node.classList.add("is-muted");
        }
        node.setAttribute("role", "button");
        node.setAttribute("tabindex", "0");
        node.setAttribute("aria-pressed", item.hidden ? "false" : "true");

        const swatch = document.createElement("span");
        swatch.className = "subtask-legend-swatch";
        swatch.style.backgroundColor = item.color;
        node.appendChild(swatch);

        const text = document.createElement("div");
        text.className = "subtask-legend-text";

        const title = document.createElement("div");
        title.className = "subtask-legend-title";
        if (item.description) {
          const titleStrong = document.createElement("span");
          titleStrong.textContent = item.title;
          title.appendChild(titleStrong);

          const description = document.createElement("span");
          description.className = "subtask-legend-inline-description";
          description.textContent = `: ${item.description}`;
          title.appendChild(description);
        } else {
          title.textContent = item.title;
        }
        text.appendChild(title);

        node.appendChild(text);
        node.addEventListener("click", function () {
          const hiddenState = state.subtaskHidden[viewMode];
          hiddenState[item.key] = !hiddenState[item.key];
          draw();
        });
        node.addEventListener("keydown", function (event) {
          if (event.key !== "Enter" && event.key !== " ") return;
          event.preventDefault();
          const hiddenState = state.subtaskHidden[viewMode];
          hiddenState[item.key] = !hiddenState[item.key];
          draw();
        });
        legend.appendChild(node);
      });
    }

    function updateSubtaskViewControls() {
      if (viewMode === "by_setting") {
        settingControl.classList.remove("is-hidden");
        methodControl.classList.add("is-hidden");
        legend.classList.remove("subtask-legend--stacked");
        bySettingBtn.classList.remove("is-light");
        bySettingBtn.classList.add("is-dark");
        byMethodBtn.classList.remove("is-dark");
        byMethodBtn.classList.add("is-light");
      } else {
        methodControl.classList.remove("is-hidden");
        settingControl.classList.add("is-hidden");
        legend.classList.add("subtask-legend--stacked");
        byMethodBtn.classList.remove("is-light");
        byMethodBtn.classList.add("is-dark");
        bySettingBtn.classList.remove("is-dark");
        bySettingBtn.classList.add("is-light");
      }
    }

    function draw() {
      let datasets = [];
      let legendItems = [];

      if (viewMode === "by_setting") {
        const setting = subtaskRadarData.settings.find((item) => item.id === settingSelect.value) || subtaskRadarData.settings[0];
        datasets = setting.methods.map((methodEntry, idx) => ({
          label: methodEntry.method,
          data: axisKeys.map((key) => methodEntry.values[key]),
          borderColor: radarMethodColors[idx % radarMethodColors.length],
          backgroundColor: `${radarMethodColors[idx % radarMethodColors.length]}33`,
          pointBackgroundColor: radarMethodColors[idx % radarMethodColors.length],
          pointBorderColor: "#ffffff",
          pointBorderWidth: 1,
          pointRadius: 3,
          borderWidth: 2,
          fill: true,
          hidden: !!state.subtaskHidden.by_setting[methodEntry.method]
        }));
        legendItems = setting.methods.map((methodEntry, idx) => ({
          key: methodEntry.method,
          title: methodEntry.method,
          description: "",
          color: radarMethodColors[idx % radarMethodColors.length],
          hidden: !!state.subtaskHidden.by_setting[methodEntry.method]
        }));
      } else {
        const selectedMethod = methodSelect.value || subtaskRadarData.settings[0].methods[0].method;
        datasets = subtaskRadarData.settings.map((setting, idx) => {
          const methodEntry = setting.methods.find((entry) => entry.method === selectedMethod);
          return {
            label: `${setting.label}: ${settingDescriptions[setting.id]}`,
            data: axisKeys.map((key) => methodEntry.values[key]),
            borderColor: radarSettingColors[idx % radarSettingColors.length],
            backgroundColor: `${radarSettingColors[idx % radarSettingColors.length]}33`,
            pointBackgroundColor: radarSettingColors[idx % radarSettingColors.length],
            pointBorderColor: "#ffffff",
            pointBorderWidth: 1,
            pointRadius: 3,
            borderWidth: 2,
            fill: true,
            hidden: !!state.subtaskHidden.by_method[setting.id]
          };
        });
        legendItems = subtaskRadarData.settings.map((setting, idx) => ({
          key: setting.id,
          title: setting.label,
          description: settingDescriptions[setting.id],
          color: radarSettingColors[idx % radarSettingColors.length],
          hidden: !!state.subtaskHidden.by_method[setting.id]
        }));
      }

      renderSubtaskLegend(legendItems, datasets);

      if (state.charts.subtask) state.charts.subtask.destroy();
      state.charts.subtask = new Chart(document.getElementById("subtask-chart"), {
        type: "radar",
        data: {
          labels: axisLabels,
          datasets
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          scales: {
            r: {
              min: 0,
              max: 100,
              ticks: { stepSize: 20 },
              angleLines: { color: "#e6e6e6" },
              grid: { color: "#d9d9d9" },
              pointLabels: { color: "#4a4a4a", font: { size: 10 } }
            }
          },
          plugins: {
            legend: { display: false }
          }
        }
      });
    }

    settingSelect.addEventListener("change", draw);
    methodSelect.addEventListener("change", draw);
    bySettingBtn.addEventListener("click", function () {
      viewMode = "by_setting";
      updateSubtaskViewControls();
      draw();
    });
    byMethodBtn.addEventListener("click", function () {
      viewMode = "by_method";
      updateSubtaskViewControls();
      draw();
    });

    updateSubtaskViewControls();
    draw();
  }

  function renderErrorCharts(errorData) {
    if (state.charts.errorTop) state.charts.errorTop.destroy();
    state.charts.errorTop = new Chart(document.getElementById("error-top-chart"), {
      type: "doughnut",
      data: {
        labels: errorData.top_level.map((x) => x.category),
        datasets: [{ data: errorData.top_level.map((x) => x.percentage), backgroundColor: ["#3273dc", "#23d160", "#ff3860"] }]
      },
      options: { responsive: true, maintainAspectRatio: false }
    });

    const groupSelect = document.getElementById("error-group");
    groupSelect.innerHTML = "";
    errorData.breakdown.forEach((group) => {
      groupSelect.appendChild(createOption(group.category, group.category));
    });

    function drawBreakdown() {
      const group = errorData.breakdown.find((g) => g.category === groupSelect.value);
      if (state.charts.errorBreakdown) state.charts.errorBreakdown.destroy();
      state.charts.errorBreakdown = new Chart(document.getElementById("error-breakdown-chart"), {
        type: "bar",
        data: {
          labels: group.children.map((c) => c.name),
          datasets: [{ label: group.category, data: group.children.map((c) => c.percentage), backgroundColor: colors }]
        },
        options: {
          indexAxis: "y",
          responsive: true,
          maintainAspectRatio: false,
          plugins: { legend: { display: false } },
          scales: { x: { beginAtZero: true } }
        }
      });
    }

    groupSelect.addEventListener("change", drawBreakdown);
    drawBreakdown();
  }

  function fetchJSON(url) {
    return fetch(url, { cache: "no-store" }).then((r) => r.json());
  }

  async function init() {
    try {
      const [changelog, settings, leaderboard, datasetStats, categoryPerformance, subtaskRadar, errorTaxonomy, exampleData] = await Promise.all([
        fetchJSON("static/jsons/changelog.json"),
        fetchJSON("data/settings.json"),
        fetchJSON("data/leaderboard.json"),
        fetchJSON("data/dataset_stats.json"),
        fetchJSON("data/category_performance.json"),
        fetchJSON("data/subtask_radar.json"),
        fetchJSON("data/error_taxonomy.json"),
        fetchJSON("data/example_data.json")
      ]);

      await loadSqlFormatter();
      fillChangelog(changelog);
      bindExampleBrowser(exampleData);

      renderSettingsList(settings);
      state.leaderboardRows = toLeaderboardRows(leaderboard);
      await preloadAllLogos(state.leaderboardRows);
      setupLeaderboardFilters(state.leaderboardRows);
      bindLeaderboardEvents();
      renderLeaderboard();
      setLeaderboardView("table");

      // renderDatasetChart(datasetStats);
      // renderCategoryChart(categoryPerformance);
      renderSubtaskChart(subtaskRadar, settings);
      // renderErrorCharts(errorTaxonomy);
    } catch (error) {
      console.error("Failed to load benchmark dashboard data:", error);
    }
  }

  document.addEventListener("DOMContentLoaded", init);
})();
