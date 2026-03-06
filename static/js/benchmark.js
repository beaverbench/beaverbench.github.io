(function () {
  const state = {
    leaderboardRows: [],
    sort: { key: "score", direction: "desc" },
    charts: {},
    logoImages: {},
    leaderboardView: "table"
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

  const subtaskMetricLabels = {
    execution_accuracy: "Execution Accuracy",
    table_retrieval_f1: "Table Retrieval F1",
    join_key_f1: "Join Key F1",
    column_mapping_f1: "Column Mapping F1",
    domain_knowledge_f1: "Domain Knowledge F1",
    query_decomposition_score: "Query Decomposition Score"
  };

  const colors = ["#3273dc", "#23d160", "#ff3860", "#ffdd57", "#00d1b2", "#7957d5", "#ff8c42", "#48c774"];
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

  function renderSubtaskChart(subtaskData) {
    const metricSelect = document.getElementById("subtask-metric");
    metricSelect.innerHTML = "";

    subtaskData.metrics.forEach((metric) => {
      metricSelect.appendChild(createOption(metric, subtaskMetricLabels[metric]));
    });

    const methods = subtaskData.settings[0].methods.map((m) => m.method);

    function draw() {
      const metric = metricSelect.value;
      const labels = subtaskData.settings.map((s) => s.setting);
      const datasets = methods.map((method, idx) => ({
        label: method,
        data: subtaskData.settings.map((setting) => {
          const row = setting.methods.find((m) => m.method === method);
          return row[metric];
        }),
        borderColor: colors[idx % colors.length],
        backgroundColor: colors[idx % colors.length],
        tension: 0.25
      }));

      if (state.charts.subtask) state.charts.subtask.destroy();
      state.charts.subtask = new Chart(document.getElementById("subtask-chart"), {
        type: "line",
        data: { labels, datasets },
        options: { responsive: true, maintainAspectRatio: false, scales: { y: { beginAtZero: true } } }
      });
    }

    metricSelect.addEventListener("change", draw);
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
      const [changelog, leaderboard, datasetStats, categoryPerformance, subtaskMetrics, errorTaxonomy] = await Promise.all([
        fetchJSON("static/jsons/changelog.json"),
        fetchJSON("data/leaderboard.json"),
        fetchJSON("data/dataset_stats.json"),
        fetchJSON("data/category_performance.json"),
        fetchJSON("data/subtask_metrics.json"),
        fetchJSON("data/error_taxonomy.json")
      ]);

      fillChangelog(changelog);

      state.leaderboardRows = toLeaderboardRows(leaderboard);
      await preloadAllLogos(state.leaderboardRows);
      setupLeaderboardFilters(state.leaderboardRows);
      bindLeaderboardEvents();
      renderLeaderboard();
      setLeaderboardView("table");

      renderDatasetChart(datasetStats);
      renderCategoryChart(categoryPerformance);
      renderSubtaskChart(subtaskMetrics);
      renderErrorCharts(errorTaxonomy);
    } catch (error) {
      console.error("Failed to load benchmark dashboard data:", error);
    }
  }

  document.addEventListener("DOMContentLoaded", init);
})();
