"use client";
import { useEffect, useCallback } from 'react';
import { driver } from "driver.js";
import "driver.js/dist/driver.css";
import { usePathname, useRouter } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';

const BASE_URL = process.env.NEXT_PUBLIC_API_URL;

async function updateOnboardingStatus(email: string, completed: boolean) {
  try {
    const response = await fetch(`${BASE_URL}/api/user/onboarding?email=${encodeURIComponent(email)}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ onboarding_completed: completed }),
    });
    
    if (!response.ok) {
      console.error('Failed to update onboarding status:', response.statusText);
    } else {
      console.log('Onboarding status saved to database');
    }
  } catch (error) {
    console.error('Error updating onboarding status:', error);
  }
}

export const useOnboarding = () => {
  const router = useRouter();
  const pathname = usePathname();
  const { user } = useAuth();

  const startOnboarding = useCallback(() => {
    // Only run on dashboard
    if (pathname !== '/chat') return;

    const driverObj = driver({
      showProgress: true,
      animate: true,
      allowClose: false,
      popoverClass: "driverjs-theme",
      steps: [
        {
          element: '#profile-menu-btn',
          popover: {
            title: 'Step 1: Your Profile',
            description: 'Click here to see your account and make changes whenever you need to.',
            side: "bottom",
            align: 'end'
          }
        },
        {
          element: '#settings-nav-link',
          popover: {
            title: 'Step 2: Settings',
            description: 'This is where you customize everything about how your AI assistant works for you.',
            side: "left",
            align: 'start'
          },
          onHighlighted: () => {
            const settingsLink = document.getElementById('settings-nav-link');
            if (settingsLink) {
              settingsLink.onclick = () => {
                localStorage.setItem('onboarding_phase', 'settings');
                driverObj.destroy();
              };
            }
          }
        }
      ],
      onDestroyed: () => {
        // Handle cleanup
      }
    });

    driverObj.drive();
    
    const profileBtn = document.getElementById('profile-menu-btn');
    if (profileBtn) {
      const handleProfileClick = () => {
        setTimeout(() => {
          driverObj.moveNext();
        }, 100);
      };
      profileBtn.addEventListener('click', handleProfileClick);
    }
  }, [pathname]);

  const resumeOnboarding = useCallback(() => {
    const phase = localStorage.getItem('onboarding_phase');
    
    if (phase === 'settings' && pathname.startsWith('/settings')) {
      const driverObj = driver({
        showProgress: true,
        animate: true,
        allowClose: true,
        popoverClass: "driverjs-theme",
        steps: [
          {
            element: '#accent-picker-section',
            popover: {
              title: 'Step 3: Choose Your Colors',
              description: 'Pick a color theme you like. This is just to make it look nice and personal to you.',
              side: "bottom",
              align: 'start'
            }
          },
          {
            element: '#timezone-section',
            popover: {
              title: 'Step 4: Set Your Time Zone',
              description: 'Tell us where you are so your AI knows the right time for your tasks and meetings.',
              side: "bottom",
              align: 'start'
            }
          },
          {
            element: '#communication-profile-section',
            popover: {
              title: 'Step 5: How Your AI Talks',
              description: 'Choose how you want your AI to sound - formal or casual, friendly or professional. Pick what feels right for you.',
              side: "top",
              align: 'start'
            }
          },
          {
            element: '#autopilot-section',
            popover: {
              title: 'Step 6: Auto-Pilot (Optional)',
              description: 'Let your AI automatically organize your emails and schedule meetings. You can always turn this off later.',
              side: "top",
              align: 'start'
            }
          },
          {
            element: '#daily-briefing-section',
            popover: {
              title: 'Step 7: Daily Briefing',
              description: 'Get a quick summary of your day with important emails and meetings automatically delivered to you.',
              side: "top",
              align: 'start'
            }
          },
          {
            element: '#add-contact-section',
            popover: {
              title: 'Step 8: Add People You Know',
              description: 'Save contacts of people you work with often. Your AI will remember them and help you better.',
              side: "top",
              align: 'start'
            }
          },
          {
            element: '#connected-apps-tab',
            popover: {
              title: 'Step 9: Connect Your Apps',
              description: 'Let\'s connect the apps you use every day - like Gmail, Calendar, Slack. This gives your AI superpowers.',
              side: "right",
              align: 'start'
            },
            onHighlighted: () => {
              const tab = document.getElementById('connected-apps-tab');
              if (tab) {
                tab.onclick = () => {
                  localStorage.setItem('onboarding_phase', 'integrations');
                  driverObj.destroy();
                };
              }
            }
          }
        ],
        onDestroyed: () => {
          // Keep phase if we are moving to next page
        }
      });

      setTimeout(() => {
        if (document.getElementById('accent-picker-section')) {
          driverObj.drive();
        }
      }, 1000);
    }

    if (phase === 'integrations' && pathname.includes('/settings/integrations')) {
      const driverObj = driver({
        showProgress: true,
        animate: true,
        allowClose: true,
        popoverClass: "driverjs-theme",
        steps: [
          {
            element: '#google-workspace-section',
            popover: {
              title: 'Step 10: Google (Gmail & Calendar)',
              description: 'Connect your Gmail and Calendar so your AI can read emails and manage your schedule.',
              side: "bottom",
              align: 'start'
            }
          },
          {
            element: '#other-platforms-section',
            popover: {
              title: 'Step 11: Other Apps',
              description: 'Connect Slack, Notion, Discord, or any other app you use. The more connected, the smarter your AI gets.',
              side: "top",
              align: 'start'
            }
          },
          {
            element: '#ai-settings-tab',
            popover: {
              title: 'Step 12: AI Brain Settings',
              description: 'Let\'s fine-tune your AI. These are the final settings that make everything work perfectly for you.',
              side: "right",
              align: 'start'
            },
            onHighlighted: () => {
              const tab = document.getElementById('ai-settings-tab');
              if (tab) {
                tab.onclick = () => {
                  localStorage.setItem('onboarding_phase', 'ai');
                  driverObj.destroy();
                };
              }
            }
          }
        ],
        onDestroyed: () => {
          // Keep phase if moving forward
        }
      });

      setTimeout(() => {
        if (document.getElementById('google-workspace-section')) {
          driverObj.drive();
        }
      }, 1000);
    }

    if (phase === 'ai' && pathname.includes('/settings/ai')) {
      const driverObj = driver({
        showProgress: true,
        animate: true,
        allowClose: true,
        popoverClass: "driverjs-theme",
        steps: [
          {
            element: '#ai-provider-selector',
            popover: {
              title: 'Step 13: Pick Your AI Engine',
              description: 'Choose which AI you want to use - ChatGPT, Google Gemini, or others. Different engines have different strengths.',
              side: "bottom",
              align: 'start'
            }
          },
          {
            element: '#ai-services-section',
            popover: {
              title: 'Step 14: Your AI Keys (Optional)',
              description: 'You can add your own AI account details if you have one. If not, we have defaults. Don\'t worry if you\'re not sure.',
              side: "top",
              align: 'start'
            }
          },
          {
            element: '#cost-optimization-section',
            popover: {
              title: 'Step 15: Smart Savings (Optional)',
              description: 'Let your AI use cheaper models for easy tasks and fancy ones only when needed. Saves you money automatically.',
              side: "top",
              align: 'start'
            }
          },
          {
            element: '#cost-widget-section',
            popover: {
              title: 'Step 16: Track Usage',
              description: 'See how much you\'ve used your AI today. Helps you understand what\'s being used.',
              side: "top",
              align: 'start'
            }
          },
          {
            element: '#response-controls-section',
            popover: {
              title: 'Step 17: AI Output Settings',
              description: 'Control how your AI responds - should it be short and quick, or detailed? Formal or casual?',
              side: "top",
              align: 'start'
            }
          },
          {
            element: '#dashboard-nav-link',
            popover: {
              title: 'Step 18: You\'re Ready!',
              description: 'All done! Click here to go back to chat and start using your AI assistant.',
              side: "bottom",
              align: 'start'
            },
            onHighlighted: () => {
              const link = document.getElementById('dashboard-nav-link');
              if (link) {
                link.onclick = () => {
                  localStorage.setItem('onboarding_phase', 'dashboard_final');
                  driverObj.destroy();
                };
              }
            }
          }
        ],
        onDestroyed: () => {
          // Cleanup handled in onHighlighted
        }
      });

      setTimeout(() => {
        if (document.getElementById('ai-provider-selector')) {
          driverObj.drive();
        }
      }, 1000);
    }

    if (phase === 'dashboard_final' && pathname === '/chat') {
      const driverObj = driver({
        showProgress: true,
        animate: true,
        allowClose: true,
        popoverClass: "driverjs-theme",
        steps: [
          {
            element: '#assistant-filter-btn',
            popover: {
              title: 'Step 19: Find Your Helpers',
              description: 'Use this to quickly find your AI assistants - your own helpers, built-in ones, or tools.',
              side: "bottom",
              align: 'start'
            }
          },
          {
            element: '#create-agent-btn',
            popover: {
              title: 'Step 20: Create Your Own AI',
              description: 'Ready to build your own AI? Click here to create a custom helper that works exactly how you want.',
              side: "bottom",
              align: 'start'
            }
          }
        ],
        onDestroyed: () => {
          localStorage.removeItem('onboarding_phase');
          localStorage.setItem('onboarding_finished', 'true');
          // Save onboarding completion to database
          if (user?.email) {
            updateOnboardingStatus(user.email, true);
          }
        }
      });

      setTimeout(() => {
        if (document.getElementById('assistant-filter-btn')) {
          driverObj.drive();
        }
      }, 1000);
    }
  }, [pathname]);

  return { startOnboarding, resumeOnboarding };
};
