import { useState } from 'react'
import { ClerkProvider, SignedIn, SignedOut, SignInButton, UserButton, useUser } from '@clerk/clerk-react'
import Header from './components/Header.jsx'
import PropAnalyzer from './components/PropAnalyzer.jsx'
import GameAnalyzer from './components/GameAnalyzer.jsx'
import BatchAnalyzer from './components/BatchAnalyzer.jsx'
import PerformanceDashboard from './components/PerformanceDashboard.jsx'
import EducationSection from './components/EducationSection.jsx'
import ConfidenceHistory from './components/ConfidenceHistory.jsx'

const CLERK_PUBLISHABLE_KEY = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;

function AppContent() {
  const [tab, setTab] = useState('props')
  const { user } = useUser()

  return (
    <div className="min-h-screen bg-dark-bg text-white">
      <Header user={user} />
      
      <div className="container mx-auto px-4 py-8">
        {/* Performance Dashboard - Visible to all users */}
        <div className="mb-8">
          <PerformanceDashboard />
        </div>

        {/* Main Navigation */}
        <div className="flex mb-8 bg-dark-card rounded-lg p-1">
          {[
            { id: 'props', label: 'Player Props' },
            { id: 'games', label: 'Game Lines' },
            { id: 'batch', label: 'Batch Analysis' },
            { id: 'education', label: 'Betting Education' },
            { id: 'history', label: 'My Confidence History' }
          ].map(t => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`flex-1 py-3 px-4 rounded-md transition-all text-sm ${
                tab === t.id 
                  ? 'bg-betting-green text-white shadow-lg' 
                  : 'text-gray-400 hover:text-white hover:bg-gray-700'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div className="max-w-6xl mx-auto">
          {tab === 'props' && <PropAnalyzer />}
          {tab === 'games' && <GameAnalyzer />}
          {tab === 'batch' && <BatchAnalyzer />}
          {tab === 'education' && <EducationSection />}
          {tab === 'history' && <ConfidenceHistory />}
        </div>
      </div>
    </div>
  )
}

export default function App() {
  return (
    <ClerkProvider publishableKey={CLERK_PUBLISHABLE_KEY}>
      <SignedOut>
        <div className="min-h-screen bg-dark-bg text-white flex items-center justify-center">
          <div className="text-center space-y-6 p-8">
            <h1 className="text-4xl font-bold text-betting-green">Master Betting System</h1>
            <p className="text-gray-400 text-lg">AI-Powered Sports Analytics</p>
            <SignInButton mode="modal">
              <button className="bg-betting-green text-white px-8 py-3 rounded-lg text-lg hover:opacity-90">
                Sign In to Continue
              </button>
            </SignInButton>
          </div>
        </div>
      </SignedOut>
      
      <SignedIn>
        <AppContent />
      </SignedIn>
    </ClerkProvider>
  )
}
