import React from 'react';
import { UserButton } from '@clerk/clerk-react';
import { downloadLogsCSV } from '../utils/analytics';

export default function Header({ user }) {
  return (
    <header className="bg-dark-card border-b border-gray-700">
      <div className="container mx-auto px-4 py-6">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold text-betting-green">Master Betting System</h1>
            <p className="text-gray-400 mt-1">Advanced Analytics for Player Props & Game Lines</p>
          </div>
          
          <div className="flex items-center gap-4">
            {/* User Info */}
            {user && (
              <div className="text-right">
                <div className="text-sm text-gray-400">Welcome back</div>
                <div className="font-semibold text-white">
                  {user.firstName || user.username || 'User'}
                </div>
              </div>
            )}

            {/* Download Logs (Admin Only) */}
            {user?.publicMetadata?.role === 'admin' && (
              <button
                onClick={() => downloadLogsCSV()}
                className="px-3 py-2 rounded-md bg-gray-700 hover:bg-gray-600 text-sm"
                title="Export analyzed picks to CSV for calibration"
              >
                Download Logs (CSV)
              </button>
            )}

            {/* System Status */}
            <div className="text-right">
              <div className="text-sm text-gray-400">System Status</div>
              <div className="flex items-center">
                <div className="w-2 h-2 bg-betting-green rounded-full mr-2"></div>
                <span className="text-betting-green">Online</span>
              </div>
            </div>

            {/* Clerk User Button */}
            <UserButton 
              afterSignOutUrl="/"
              appearance={{
                elements: {
                  avatarBox: "w-10 h-10"
                }
              }}
            />
          </div>
        </div>
      </div>
    </header>
  );
}
