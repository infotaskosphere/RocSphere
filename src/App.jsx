import React, { useEffect, useState } from "react";

const API_BASE = "http://127.0.0.1:8000/api/roc";

export default function App() {
  const [companies, setCompanies] = useState([]);
  const [dashboard, setDashboard] = useState(null);
  const [loading, setLoading] = useState(false);
  const [darkMode, setDarkMode] = useState(false);

  /* ==============================
     FETCH COMPANIES
  ============================== */
  const fetchCompanies = async () => {
    try {
      const res = await fetch(`${API_BASE}/companies`);
      const data = await res.json();
      setCompanies(data);
    } catch (err) {
      console.error("Error fetching companies:", err);
    }
  };

  /* ==============================
     FETCH DASHBOARD SUMMARY
  ============================== */
  const fetchDashboard = async () => {
    try {
      const res = await fetch(`${API_BASE}/dashboard-summary`);
      const data = await res.json();
      setDashboard(data);
    } catch (err) {
      console.error("Error fetching dashboard:", err);
    }
  };

  /* ==============================
     ADD COMPANY
  ============================== */
  const addCompany = async (companyData) => {
    try {
      setLoading(true);

      const res = await fetch(`${API_BASE}/companies`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(companyData),
      });

      if (!res.ok) throw new Error("Failed to add company");

      await fetchCompanies();
      await fetchDashboard();
    } catch (err) {
      console.error(err);
      alert("Error adding company");
    } finally {
      setLoading(false);
    }
  };

  /* ==============================
     UPDATE FILING STATUS
  ============================== */
  const updateFilingStatus = async (companyId, ruleId, status) => {
    try {
      const res = await fetch(
        `${API_BASE}/filing-status/${companyId}`,
        {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            rule_id: ruleId,
            status: status,
          }),
        }
      );

      if (!res.ok) throw new Error("Failed to update filing");

      await fetchCompanies();
      await fetchDashboard();
    } catch (err) {
      console.error(err);
      alert("Error updating filing status");
    }
  };

  /* ==============================
     INITIAL LOAD
  ============================== */
  useEffect(() => {
    fetchCompanies();
    fetchDashboard();
  }, []);

  /* ==============================
     UI
  ============================== */
  return (
    <div
      style={{
        minHeight: "100vh",
        background: darkMode ? "#121212" : "#f4f6f9",
        color: darkMode ? "#fff" : "#000",
        padding: 20,
      }}
    >
      <h1>RocSphere Dashboard</h1>

      <button onClick={() => setDarkMode(!darkMode)}>
        Toggle {darkMode ? "Light" : "Dark"} Mode
      </button>

      {/* DASHBOARD CARDS */}
      {dashboard && (
        <div style={{ display: "flex", gap: 20, marginTop: 20 }}>
          <Card title="Total Companies" value={dashboard.total_companies} />
          <Card title="Overdue Forms" value={dashboard.total_overdue_forms} />
          <Card title="Due in 30 Days" value={dashboard.due_within_30_days} />
          <Card
            title="Late Fee Exposure"
            value={`₹ ${dashboard.total_late_fee_exposure}`}
          />
          <Card
            title="Compliance %"
            value={`${dashboard.compliance_completion_percentage}%`}
          />
        </div>
      )}

      {/* COMPANY LIST */}
      <h2 style={{ marginTop: 40 }}>Companies</h2>

      {companies.map((company) => (
        <div
          key={company._id}
          style={{
            padding: 15,
            marginBottom: 10,
            background: darkMode ? "#1e1e1e" : "#fff",
            borderRadius: 8,
          }}
        >
          <strong>{company.name}</strong>

          <div style={{ marginTop: 10 }}>
            <button
              onClick={() =>
                updateFilingStatus(company._id, "mgt7", "filed")
              }
            >
              Mark MGT-7 Filed
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

/* ==============================
   CARD COMPONENT
============================== */
function Card({ title, value }) {
  return (
    <div
      style={{
        padding: 20,
        background: "#ffffff",
        borderRadius: 10,
        minWidth: 180,
        boxShadow: "0 2px 8px rgba(0,0,0,0.1)",
      }}
    >
      <h4>{title}</h4>
      <h2>{value}</h2>
    </div>
  );
}
