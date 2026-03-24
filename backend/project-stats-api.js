app.get('/api/projects/stats', async (req, res) => {
  try {
    const totalProjectsQuery = 'SELECT COUNT(*) as total FROM projects';
    const [totalProjects] = await pool.query(totalProjectsQuery);
    
    const activeProjectsQuery = 'SELECT COUNT(*) as total FROM projects WHERE status = "Active"';
    const [activeProjects] = await pool.query(activeProjectsQuery);
    
    const completedProjectsQuery = 'SELECT COUNT(*) as total FROM projects WHERE status = "Completed"';
    const [completedProjects] = await pool.query(completedProjectsQuery);
    
    const avgSpendingQuery = `
      SELECT 
        COALESCE(SUM(CASE WHEN t.type = 'Expense' THEN t.amount ELSE 0 END), 0) AS totalExpenses,
        COALESCE(SUM(CASE WHEN t.type = 'Income' THEN t.amount ELSE 0 END), 0) AS totalIncome
      FROM transactions t
      WHERE t.project_id IS NOT NULL
    `;
    const [avgSpending] = await pool.query(avgSpendingQuery);
    
    res.json({
      totalProjects: totalProjects[0].total,
      activeProjects: activeProjects[0].total,
      completedProjects: completedProjects[0].total,
      totalExpenses: avgSpending[0].totalExpenses,
      totalIncome: avgSpending[0].totalIncome
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/projects/:id/stats', async (req, res) => {
  try {
    const projectId = req.params.id;
    
    const projectQuery = 'SELECT * FROM projects WHERE id = ?';
    const [projectRows] = await pool.query(projectQuery, [projectId]);
    
    if (projectRows.length === 0) {
      return res.status(404).json({ error: 'Project not found' });
    }
    
    const project = projectRows[0];
    
    const statsQuery = `
      SELECT 
        COALESCE(SUM(CASE WHEN t.type = 'Expense' THEN t.amount ELSE 0 END), 0) AS totalExpenses,
        COALESCE(SUM(CASE WHEN t.type = 'Income' THEN t.amount ELSE 0 END), 0) AS totalIncome,
        COUNT(*) AS transactionCount
      FROM transactions t
      WHERE t.project_id = ?
    `;
    const [statsRows] = await pool.query(statsQuery, [projectId]);
    const stats = statsRows[0];
    
    const totalExpenses = parseFloat(stats.totalExpenses) || 0;
    const totalIncome = parseFloat(stats.totalIncome) || 0;
    const netProfit = totalIncome - totalExpenses;
    const margin = totalIncome > 0 ? ((netProfit / totalIncome) * 100).toFixed(2) : 0;
    
    res.json({
      project: {
        id: project.id,
        name: project.name,
        status: project.status,
        createdAt: project.created_at,
        updatedAt: project.updated_at
      },
      metrics: {
        totalExpenses,
        totalIncome,
        netProfit,
        margin: parseFloat(margin),
        transactionCount: stats.transactionCount
      }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});