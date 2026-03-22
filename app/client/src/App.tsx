import { Routes, Route } from 'react-router-dom';
import Layout from './components/Layout';
import ProtectedRoute from './components/ProtectedRoute';
import Home from './pages/Home';
import Login from './pages/Login';
import Register from './pages/Register';
import Dashboard from './pages/Dashboard';
import PrinterProfile from './pages/PrinterProfile';
import PrinterList from './pages/PrinterList';
import JobList from './pages/JobList';
import JobDetail from './pages/JobDetail';
import CreateJob from './pages/CreateJob';
import Orders from './pages/Orders';
import ReviewForm from './pages/ReviewForm';
import AuthCallback from './pages/AuthCallback';
import NotificationSettings from './pages/NotificationSettings';
import UnsubscribeConfirm from './pages/UnsubscribeConfirm';
import StripeOnboard from './pages/StripeOnboard';
import AdminLayout from './pages/admin/AdminLayout';
import AdminDashboard from './pages/admin/AdminDashboard';
import AdminUsers from './pages/admin/AdminUsers';
import AdminJobs from './pages/admin/AdminJobs';
import AdminDisputes from './pages/admin/AdminDisputes';

export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route path="/" element={<Home />} />
        <Route path="/login" element={<Login />} />
        <Route path="/register" element={<Register />} />
        <Route path="/printers" element={<PrinterList />} />
        <Route path="/printers/:id" element={<PrinterProfile />} />
        <Route path="/jobs" element={<JobList />} />
        <Route path="/jobs/:id" element={<JobDetail />} />
        <Route path="/jobs/new" element={<ProtectedRoute><CreateJob /></ProtectedRoute>} />
        <Route path="/orders" element={<ProtectedRoute><Orders /></ProtectedRoute>} />
        <Route path="/orders/:orderId/review" element={<ProtectedRoute><ReviewForm /></ProtectedRoute>} />
        <Route path="/dashboard" element={<ProtectedRoute><Dashboard /></ProtectedRoute>} />
        <Route path="/auth/callback" element={<AuthCallback />} />
        <Route path="/settings/notifications" element={<ProtectedRoute><NotificationSettings /></ProtectedRoute>} />
        <Route path="/unsubscribe" element={<UnsubscribeConfirm />} />
        <Route path="/printers/stripe/onboard" element={<ProtectedRoute><StripeOnboard /></ProtectedRoute>} />
        <Route path="/printers/stripe/callback" element={<ProtectedRoute><StripeOnboard /></ProtectedRoute>} />
      </Route>
      <Route path="/admin" element={<ProtectedRoute><AdminLayout /></ProtectedRoute>}>
        <Route index element={<AdminDashboard />} />
        <Route path="users" element={<AdminUsers />} />
        <Route path="jobs" element={<AdminJobs />} />
        <Route path="disputes" element={<AdminDisputes />} />
      </Route>
    </Routes>
  );
}
