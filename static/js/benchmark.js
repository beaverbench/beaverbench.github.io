(function () {
  const state = {
    leaderboardRows: [],
    sort: { key: "score", direction: "desc" },
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
    if (sourceFile === "filtered_chain_without_domain.json") {
      return "Complex query";
    }
    if (sourceFile === "filtered_tree_with_domain.json") {
      return "Domain-specific query";
    }
    if (
      sourceFile === "filtered_tree_chain_with_domain.json" ||
      sourceFile === "filtered_chain_tree_with_domain.json"
    ) {
      return "Domain-specific complex query";
    }
    return sourceFile || "example";
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
        key.textContent = phrase;
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
        questionKey.textContent = `subquery ${index}`;
        item.appendChild(questionKey);

        const questionValue = document.createElement("p");
        questionValue.className = "example-subquery-value";
        questionValue.textContent = subqueryQuestions[index] || "No subquery question";
        item.appendChild(questionValue);

        const sqlKey = document.createElement("div");
        sqlKey.className = "example-subquery-key";
        sqlKey.textContent = `sub-SQL ${index}`;
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
    if (model.startsWith("Claude")) return "static/images/claude.webp";
    if (model.startsWith("GPT")) return "static/images/openai.webp";
    if (model.startsWith("Gemini")) return "static/images/gemini.webp";
    if (model.startsWith("Qwen")) return "static/images/qwen.png";
    if (model.startsWith("MiniMax")) return "static/images/minimax.jpeg";
    if (model === "Overall") return "static/images/beaver.png";
    return "static/images/beaver.png";
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
    const paths = [...new Set(rows.map((row) => row.logo))];
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

  function addLeaderboardRanks(rows) {
    const sorted = [...rows].sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      const methodCmp = a.method.localeCompare(b.method);
      if (methodCmp !== 0) return methodCmp;
      return a.model.localeCompare(b.model);
    });

    const ranked = sorted.map((row, index) => ({
      ...row,
      rank: index + 1
    }));

    const rankMap = {};
    ranked.forEach((row) => {
      rankMap[`${row.method}__${row.model}`] = row.rank;
    });

    return rows.map((row) => ({
      ...row,
      rank: rankMap[`${row.method}__${row.model}`]
    }));
  }

  function toLeaderboardRows(leaderboardData) {
    const rows = [];
    leaderboardData.methods.forEach((methodRow) => {
      leaderboardData.models.forEach((model) => {
        rows.push({
          method: methodRow.method,
          model,
          score: methodRow.scores[model],
          submission_date: methodRow.submission_date || "Unknown",
          logo: logoPathForModel(model)
        });
      });
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

  function renderLeaderboardScatter(rows) {
    const points = rows.map((row) => ({
      x: row.score,
      y: row.rank,
      method: row.method,
      model: row.model,
      submission_date: row.submission_date,
      logo: row.logo
    }));
    const xValues = points.map((p) => p.x);
    const yValues = points.map((p) => p.y);
    const xMin = Math.min.apply(null, xValues);
    const xMax = Math.max.apply(null, xValues);
    const yMin = Math.min.apply(null, yValues);
    const yMax = Math.max.apply(null, yValues);

    if (state.charts.leaderboardScatter) state.charts.leaderboardScatter.destroy();
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
        }]
      },
      plugins: [leaderboardLogoOverlayPlugin],
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: function (context) {
                const raw = context.raw;
                return `${raw.method} · ${raw.model} · Rank ${raw.y} · ${raw.submission_date} · ${raw.x.toFixed(1)}`;
              }
            }
          }
        },
        scales: {
          x: {
            title: { display: true, text: "Execution Accuracy" },
            min: xMin - 0.5,
            max: xMax + 0.5
          },
          y: {
            title: { display: true, text: "Rank" },
            reverse: true,
            min: yMin - 0.5,
            max: yMax + 0.5,
            ticks: { precision: 0 }
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
      if (key === "score" || key === "rank") return (a[key] - b[key]) * order;
      return a[key].localeCompare(b[key]) * order;
    });

    tbody.innerHTML = "";
    filtered.forEach((row) => {
      const tr = document.createElement("tr");
      tr.innerHTML = `<td class="rank-cell"><div class="rank-number">${row.rank}</div></td><td><span class="date-pill">${row.submission_date}</span></td><td>${row.method}</td><td><span class="model-cell"><img class="model-logo" src="${row.logo}" alt="${row.model} logo" onerror="this.src='static/images/beaver.png'" /><span>${row.model}</span></span></td><td>${row.score.toFixed(1)}</td>`;
      tbody.appendChild(tr);
    });

    renderLeaderboardScatter(filtered);
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
          state.sort.direction = key === "score" ? "desc" : "asc";
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
    const metrics = [
      ["complex_queries", "Complex"],
      ["domain_specific_queries", "Domain-Specific"],
      ["domain_specific_complex_queries", "Domain+Complex"],
      ["synthetic_overall", "Synthetic Overall"],
      ["real_overall", "Real Overall"]
    ];

    const datasets = metrics.map((metric, idx) => ({
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

  function renderSubtaskChart(subtaskRadarData) {
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
        createOption(setting.id, `${setting.label}: ${setting.description}`)
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
        title.textContent = item.title;
        text.appendChild(title);

        if (item.description) {
          const description = document.createElement("div");
          description.className = "subtask-legend-description";
          description.textContent = item.description;
          text.appendChild(description);
        }

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
            label: `${setting.label}: ${setting.description}`,
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
          description: setting.description,
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
      const [changelog, leaderboard, datasetStats, categoryPerformance, subtaskRadar, errorTaxonomy, exampleData] = await Promise.all([
        fetchJSON("static/jsons/changelog.json"),
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

      state.leaderboardRows = toLeaderboardRows(leaderboard);
      await preloadAllLogos(state.leaderboardRows);
      setupLeaderboardFilters(state.leaderboardRows);
      bindLeaderboardEvents();
      renderLeaderboard();
      setLeaderboardView("table");

      // renderDatasetChart(datasetStats);
      // renderCategoryChart(categoryPerformance);
      renderSubtaskChart(subtaskRadar);
      // renderErrorCharts(errorTaxonomy);
    } catch (error) {
      console.error("Failed to load benchmark dashboard data:", error);
    }
  }

  document.addEventListener("DOMContentLoaded", init);
})();
