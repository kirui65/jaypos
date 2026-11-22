import { Link, Route, Routes } from "react-router-dom";
import { APP_NAME } from "@eminent/shared";

function HomePage() {
  return (
    <main className="welcome">
      <p>Retail point of sale</p>
      <h1>{APP_NAME}</h1>
      <p>The core POS foundation is ready for the next milestone.</p>
      <Link to="/health">Check API connection</Link>
    </main>
  );
}

function HealthPage() {
  return (
    <main className="welcome">
      <h1>API health</h1>
      <p>API endpoint: {import.meta.env.VITE_API_URL ?? "http://localhost:3001"}/health</p>
    </main>
  );
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<HomePage />} />
      <Route path="/health" element={<HealthPage />} />
    </Routes>
  );
}
