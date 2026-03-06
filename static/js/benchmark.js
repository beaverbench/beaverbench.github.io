(function () {
  const state = {
    leaderboardRows: [],
    sort: { key: "score", direction: "desc" },
    charts: {}
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

  function toLeaderboardRows(leaderboardData) {
    const rows = [];
    leaderboardData.methods.forEach((methodRow) => {
      leaderboardData.models.forEach((model) => {
        rows.push({ method: methodRow.method, model, score: methodRow.scores[model] });
      });
    });
    return rows;
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
      if (key === "score") return (a.score - b.score) * order;
      return a[key].localeCompare(b[key]) * order;
    });

    tbody.innerHTML = "";
    filtered.forEach((row) => {
      const tr = document.createElement("tr");
      tr.innerHTML = `<td>${row.method}</td><td>${row.model}</td><td>${row.score.toFixed(1)}</td>`;
      tbody.appendChild(tr);
    });
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

  async function init() {
    try {
      const [changelog, leaderboard, datasetStats, categoryPerformance, subtaskMetrics, errorTaxonomy] = await Promise.all([
        fetch("static/jsons/changelog.json").then((r) => r.json()),
        fetch("data/leaderboard.json").then((r) => r.json()),
        fetch("data/dataset_stats.json").then((r) => r.json()),
        fetch("data/category_performance.json").then((r) => r.json()),
        fetch("data/subtask_metrics.json").then((r) => r.json()),
        fetch("data/error_taxonomy.json").then((r) => r.json())
      ]);

      fillChangelog(changelog);

      state.leaderboardRows = toLeaderboardRows(leaderboard);
      setupLeaderboardFilters(state.leaderboardRows);
      bindLeaderboardEvents();
      renderLeaderboard();

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
