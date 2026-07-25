"""
Integration Registry
Single source of truth for all supported platforms.

To add a new platform: add one dict entry here. No code changes elsewhere.

auth_type:
  "oauth2"     - standard OAuth2 Authorization Code flow
  "api_key"    - user pastes one or more keys via the Settings UI
  "bot_token"  - single token from platform's bot/app settings

oauth2 fields (required when auth_type == "oauth2"):
  oauth_authorize_url, oauth_token_url, scopes,
  client_id_env, client_secret_env

api_key fields (required when auth_type == "api_key" or "bot_token"):
  ui_fields: list of {name, label, placeholder, type}

test_endpoint:
  URL used to verify the credential is valid.
  Use {token} placeholder where the token should be substituted.
"""

INTEGRATION_REGISTRY: dict = {
    # ── OAuth2 Platforms ───────────────────────────────────────────────────────

    "linkedin": {
        "name": "LinkedIn",
        "description": "Post updates, share articles, and publish content to your LinkedIn feed",
        "auth_type": "oauth2",
        "oauth_authorize_url": "https://www.linkedin.com/oauth/v2/authorization",
        "oauth_token_url": "https://www.linkedin.com/oauth/v2/accessToken",
        "scopes": ["openid", "profile", "email", "w_member_social"],
        "client_id_env": "LINKEDIN_CLIENT_ID",
        "client_secret_env": "LINKEDIN_CLIENT_SECRET",
        "token_path": "access_token",
        "test_endpoint": "https://api.linkedin.com/v2/userinfo",
        "color": "#0A66C2",
        "icon_key": "linkedin",
    },

    "slack": {
        "name": "Slack",
        "description": "Send messages, read channels, search, upload files, manage workspace notifications",
        "auth_type": "oauth2",
        "oauth_authorize_url": "https://slack.com/oauth/v2/authorize",
        "oauth_token_url": "https://slack.com/api/oauth.v2.access",
        # Bot scopes (prefix "bot:" not needed — these go in the `scope` param for Slack OAuth v2)
        # groups:read / im:read / mpim:read needed for private channels + DMs in conversations_list
        # files:write needed for files_upload_v2
        "scopes": [
            "chat:write", "chat:write.public",
            "channels:read", "channels:history",
            "groups:read", "groups:history",
            "im:read", "im:history",
            "mpim:read", "mpim:history",
            "files:write", "files:read",
            "users:read", "users:read.email",
            "reactions:write", "reactions:read",
            "team:read",
        ],
        # user_scopes go in the separate `user_scope` param — needed for search:read
        "user_scopes": ["search:read", "identify"],
        "client_id_env": "SLACK_CLIENT_ID",
        "client_secret_env": "SLACK_CLIENT_SECRET",
        "token_path": "access_token",  # bot token — user token is in authed_user.access_token
        "test_endpoint": "https://slack.com/api/auth.test",
        "color": "#4A154B",
        "icon_key": "slack",
    },

    "github": {
        "name": "GitHub",
        "description": "Manage issues, pull requests, and repositories",
        "auth_type": "oauth2",
        "oauth_authorize_url": "https://github.com/login/oauth/authorize",
        "oauth_token_url": "https://github.com/login/oauth/access_token",
        "scopes": ["repo", "read:user", "read:org"],
        "client_id_env": "GITHUB_CLIENT_ID",
        "client_secret_env": "GITHUB_CLIENT_SECRET",
        "token_path": "access_token",
        "test_endpoint": "https://api.github.com/user",
        "color": "#333333",
        "icon_key": "github",
    },

    # Jira integration disabled
    # "jira": {
    #     "name": "Jira",
    #     "description": "Create tickets, manage sprints, search with JQL",
    #     "auth_type": "oauth2",
    #     "oauth_authorize_url": "https://auth.atlassian.com/authorize",
    #     "oauth_token_url": "https://auth.atlassian.com/oauth/token",
    #     "scopes": ["read:jira-work", "write:jira-work", "read:jira-user", "offline_access"],
    #     "extra_params": {
    #         "audience": "api.atlassian.com",
    #         "prompt": "consent",
    #     },
    #     "client_id_env": "ATLASSIAN_CLIENT_ID",
    #     "client_secret_env": "ATLASSIAN_CLIENT_SECRET",
    #     "token_path": "access_token",
    #     "test_endpoint": "https://api.atlassian.com/me",
    #     "color": "#0052CC",
    #     "icon_key": "jira",
    # },

    "notion": {
        "name": "Notion",
        "description": "Read and write Notion pages, databases, and blocks",
        "auth_type": "oauth2",
        "oauth_authorize_url": "https://api.notion.com/v1/oauth/authorize",
        "oauth_token_url": "https://api.notion.com/v1/oauth/token",
        "token_exchange_auth": "basic",  # Notion requires Basic auth, not body params
        "scopes": [],
        "client_id_env": "NOTION_CLIENT_ID",
        "client_secret_env": "NOTION_CLIENT_SECRET",
        "token_path": "access_token",
        "test_endpoint": "https://api.notion.com/v1/users/me",
        "color": "#000000",
        "icon_key": "notion",
    },

    # ── API Key Platforms ──────────────────────────────────────────────────────

    "trello": {
        "name": "Trello",
        "description": "View boards, create cards, move cards between lists",
        "auth_type": "api_key",
        "ui_fields": [
            {"name": "api_key", "label": "API Key", "placeholder": "Paste your Trello API Key", "type": "password"},
            {"name": "token", "label": "Access Token", "placeholder": "Paste your Trello Access Token", "type": "password"},
        ],
        "test_endpoint": "https://api.trello.com/1/members/me",
        "test_auth": "query_params",
        "test_query_params": ["api_key", "token"],
        "test_query_param_map": {"api_key": "key", "token": "token"},
        "color": "#0052CC",
        "icon_key": "trello",
        "help_url": "https://trello.com/app-key",
        "instructions": (
            "1. Make sure you are logged in to Trello in your browser first - the page won't work if you're signed out.\n"
            "2. Open a new tab and go to: trello.com/app-key - this is Trello's official developer page.\n"
            "3. You'll see a page titled 'Trello Developer API Keys'. Look for the long string of letters and numbers labeled 'Key' near the top. Click the copy icon next to it and paste it into the 'API Key' field on the left.\n"
            "4. Now click the blue 'Token' link on that same page (it's right underneath the API Key). A new page will open asking you to approve access - click the green 'Allow' button.\n"
            "5. You'll see a long string of letters and numbers on screen - this is your Access Token. Select all of it (Ctrl+A or Cmd+A), copy it, and paste it into the 'Access Token' field on the left.\n"
            "6. Treat both values like passwords. Never share them - anyone who has them can access your Trello boards.\n"
            "7. Once both fields are filled in, click 'Connect'. You should see a green confirmation within a few seconds."
        ),
        "ui_flow": [
            {"type": "action", "label": "Open Trello API Page", "url": "https://trello.com/app-key", "description": [
                "Make sure you are already logged in to Trello in your browser, then click the button below.",
                "You will land on Trello's official developer page - don't worry, it's safe and run by Trello themselves."
            ]},
            {"type": "input", "label": "API Key", "field": "api_key", "description": [
                "On that page, you will see a box near the top labeled 'Key' with a long string of letters and numbers next to it.",
                "Click the copy icon beside it (or select all the text and copy it), then come back here and paste it in the box below."
            ]},
            {"type": "action", "label": "Generate Token", "url": "https://trello.com/app-key", "description": [
                "Now you need a second piece called an Access Token.",
                "On the same Trello page, look for a blue link that says 'Token' - it's just below the API Key. Click it.",
                "A new page will open asking you to give permission. Click the green 'Allow' button."
            ]},
            {"type": "input", "label": "Access Token", "field": "token", "description": [
                "After clicking Allow, Trello will show you a very long string of letters and numbers on the screen - this is your Access Token.",
                "Select all of it (you can press Ctrl+A on Windows or Cmd+A on Mac), copy it, and paste it into the box below.",
                "Treat this like a password and never share it."
            ]}
        ],
    },

    "discord": {
        "name": "Discord",
        "description": "Send messages, read channels, and manage your Discord servers",
        # OAuth2 with 'bot' scope: user clicks Connect and picks which server to add the bot to.
        # The server-side DISCORD_BOT_TOKEN does the actual messaging — never exposed to users.
        # identify + guilds let us store which guild was authorized for per-user routing.
        "auth_type": "oauth2",
        "oauth_authorize_url": "https://discord.com/oauth2/authorize",
        "oauth_token_url": "https://discord.com/api/oauth2/token",
        "scopes": ["identify", "guilds"],
        "extra_params": {
            # bot scope makes the authorize page show "Add to Server" picker.
            # permissions 68608 = Send Messages (2048) + Read History (65536) + View Channels (1024)
            "permissions": "68608",
            "scope": "bot identify guilds",
        },
        "client_id_env": "DISCORD_CLIENT_ID",
        "client_secret_env": "DISCORD_CLIENT_SECRET",
        "token_path": "access_token",
        "test_endpoint": "https://discord.com/api/v10/users/@me",
        "color": "#5865F2",
        "icon_key": "discord",
    },

    "calcom": {
        "name": "Cal.com",
        "description": "Generate personalised booking links, fetch upcoming meetings, and sync meeting bookings with outreach contacts",
        "auth_type": "oauth2",
        "oauth_authorize_url": "https://app.cal.com/auth/oauth2/authorize",
        "oauth_token_url": "https://app.cal.com/auth/oauth2/token",
        "scopes": ["READ_PROFILE"],
        "client_id_env": "CAL_CLIENT_ID",
        "client_secret_env": "CAL_CLIENT_SECRET",
        "token_path": "access_token",
        "test_endpoint": "https://api.cal.com/v2/me",
        "test_headers": {"cal-api-version": "2024-09-04"},
        "color": "#111827",
        "icon_key": "calcom",
        "category": "productivity",
    },

    "telegram": {
        "name": "Telegram Bot",
        "description": "Autonomous alerts and real-time chat task execution",
        "auth_type": "bot_token",
        "ui_fields": [
            {"name": "bot_token", "label": "Bot Token", "placeholder": "Paste the token from @BotFather", "type": "password"},
        ],
        "test_endpoint": "https://api.telegram.org/bot{token}/getMe",
        "help_url": "https://t.me/BotFather",
        "instructions": (
            "1. A 'bot' is like a personal assistant account inside Telegram that AutoDeskAI uses to send you messages and receive your commands. You need to create one - it only takes 2 minutes and is completely free.\n"
            "2. Open the Telegram app on your phone or desktop. In the search bar at the top, type @BotFather and tap the result that has a blue checkmark - this is the official Telegram bot creator.\n"
            "3. Tap or click 'Start' at the bottom of the chat (or type /start and send it). BotFather will reply with a list of commands it supports.\n"
            "4. Send the message exactly as shown: /newbot - BotFather will ask you two questions.\n"
            "5. First question: 'Alright, a new bot. How are we going to call it?' - Type a friendly display name, for example: My AI Assistant. This is what people see when they chat with your bot.\n"
            "6. Second question: 'Now let's choose a username for your bot.' - Type a unique username that must end with the word 'bot', for example: myaiassistant_bot. If that name is taken, try adding numbers like myaiassistant2_bot.\n"
            "7. BotFather will send a success message containing your token - it looks like this: 7894561230:AAGhxyz_abcdefGHIJKLMN1234567890. Copy the entire string including the colon and numbers at the start.\n"
            "8. Paste that token into the 'Bot Token' field on the left and click Connect.\n"
            "9. After connecting, open Telegram and search for your new bot by its username. Send it any message to start the chat - this lets AutoDeskAI send you notifications and respond to your commands."
        ),
        "ui_flow": [
            {"type": "action", "label": "Open @BotFather", "url": "https://t.me/BotFather", "description": [
                "Click the button below to open BotFather in Telegram - this is Telegram's official tool for creating bots.",
                "It has a blue checkmark so you know it is the real one.",
                "Once it opens, tap or click the 'Start' button at the bottom of the chat."
            ]},
            {"type": "text", "description": [
                "In the chat with BotFather, type /newbot and send it.",
                "BotFather will ask you two simple questions: first, a friendly display name for your bot (for example: My Assistant), and second, a username that must end with the word 'bot' (for example: myassistant_bot).",
                "After you answer both, BotFather will send you a success message containing your Bot Token - it looks like a long string of numbers and letters separated by a colon."
            ]},
            {"type": "input", "label": "Bot Token", "field": "bot_token", "description": [
                "Find the token in the message BotFather just sent you.",
                "It looks like this: 7894561230:AAGhxyz_abcdefGHIJKLMN1234.",
                "Copy the entire thing - including the numbers and colon at the beginning - and paste it into the box below."
            ]}
        ],
        "color": "#229ED9",
        "icon_key": "telegram",
    },

    "openai": {
        "name": "OpenAI",
        "description": "Use GPT-4o and other OpenAI models as your AI provider",
        "auth_type": "api_key",
        "ui_fields": [
            {"name": "api_key", "label": "API Key", "placeholder": "Paste your OpenAI API key (starts with sk-...)", "type": "password"},
        ],
        "test_endpoint": "https://api.openai.com/v1/models",
        "help_url": "https://platform.openai.com/api-keys",
        "instructions": (
            "1. An API key is like a password that lets AutoDeskAI use OpenAI's AI on your behalf. You will need an OpenAI account with a payment method added - usage is billed per request but costs are typically a few cents for normal daily use.\n"
            "2. Open a browser and go to: platform.openai.com. If you don't have an account, click 'Sign up' and follow the steps (it takes about 2 minutes). If you already have a ChatGPT account, you can use the same login.\n"
            "3. Once you're logged in, look at the left sidebar - you should see a key icon labeled 'API keys'. Click it. If you don't see a sidebar, click the menu icon (three lines) in the top-left corner first.\n"
            "4. On the API Keys page, click the green button labeled '+ Create new secret key'. A small popup will appear - give your key a memorable name like 'AutoDeskAI' so you know what it's for, then click 'Create secret key'.\n"
            "5. A long string starting with 'sk-' will appear on screen - this is your API key. Click the copy icon next to it right now. IMPORTANT: once you close this popup, OpenAI will never show you this key again.\n"
            "6. Paste the key into the 'API Key' field on the left. It should look like: sk-proj-xxxxxxxxxxxx or sk-xxxxxxxxxxxx.\n"
            "7. To make sure billing works, go to platform.openai.com/settings/billing and add a credit card. OpenAI requires this even for small usage. You can set a monthly spending limit under 'Usage limits' so there are no surprises.\n"
            "8. Come back here and click 'Connect'. AutoDeskAI will verify the key is working before saving it."
        ),
        "ui_flow": [
            {"type": "action", "label": "Go to OpenAI API Keys", "url": "https://platform.openai.com/api-keys", "description": [
                "Click the button below to open OpenAI's developer platform.",
                "Sign in with your existing OpenAI or ChatGPT account, or create a free account if you don't have one.",
                "Once you're logged in, you should land directly on the API Keys page."
            ]},
            {"type": "action", "label": "Create New Key", "url": "https://platform.openai.com/api-keys", "description": [
                "On the API Keys page, look for a green button labeled '+ Create new secret key'. Click it.",
                "Give your key a name like 'AutoDeskAI' so you remember what it's for, then click 'Create secret key'.",
                "Important: copy the key immediately after it appears - OpenAI will never show it to you again after you close that popup."
            ]},
            {"type": "input", "label": "API Key", "field": "api_key", "description": [
                "Paste the key you just copied into the box below.",
                "It should start with 'sk-' followed by a long string of letters and numbers.",
                "If you accidentally closed the popup without copying, you will need to create a new key - just repeat the previous step."
            ]}
        ],
        "color": "#10A37F",
        "icon_key": "openai",
        "category": "llm",
    },

    "anthropic": {
        "name": "Anthropic (Claude)",
        "description": "Use Claude models as your AI provider",
        "auth_type": "api_key",
        "ui_fields": [
            {"name": "api_key", "label": "API Key", "placeholder": "Paste your Anthropic API key (starts with sk-ant-...)", "type": "password"},
        ],
        "test_endpoint": None,
        "help_url": "https://console.anthropic.com/settings/keys",
        "instructions": (
            "1. Claude is made by Anthropic. To use it here, you need an Anthropic account and an API key. Like OpenAI, usage is billed per request - but costs are typically very low for everyday tasks. You'll need a credit card on file.\n"
            "2. Open a browser and go to: console.anthropic.com. Click 'Sign up' if you don't have an account - you can sign up with Google or an email address.\n"
            "3. Once logged in, look at the left sidebar for 'Settings'. Click it. On the Settings page, look for the 'API Keys' section in the left sub-menu and click it.\n"
            "4. Click the button labeled '+ Create Key'. A popup will ask you to name your key - type something like 'AutoDeskAI' and click 'Create Key'.\n"
            "5. A long string starting with 'sk-ant-' will appear. Copy the entire string - it will not be shown again after you close the popup.\n"
            "6. Paste the key into the 'API Key' field on the left. It should look like: sk-ant-api03-xxxxxxxxxxxxxxxx.\n"
            "7. To add billing, go to console.anthropic.com/settings/billing and enter a credit card. You can set spending limits there as well.\n"
            "8. Click 'Connect' here to finish. AutoDeskAI will confirm the key is valid before saving."
        ),
        "ui_flow": [
            {"type": "action", "label": "Go to Anthropic Console", "url": "https://console.anthropic.com/settings/keys", "description": [
                "Click the button below to open Anthropic's developer console.",
                "Sign in with your account (or sign up for free - you can use Google or an email address).",
                "Once logged in, you should land directly on the API Keys settings page."
            ]},
            {"type": "action", "label": "Create Key", "url": "https://console.anthropic.com/settings/keys", "description": [
                "On that page, click the button labeled '+ Create Key'.",
                "A popup will appear - type a name like 'AutoDeskAI' so you know what this key is used for, then click 'Create Key'.",
                "Copy the key that appears immediately - it starts with 'sk-ant-' and will not be shown again after you close the popup."
            ]},
            {"type": "input", "label": "API Key", "field": "api_key", "description": [
                "Paste the key into the box below. It should look like: sk-ant-api03-xxxxxxxxxxxxxxxx.",
                "If you missed copying it, simply go back and create a new key - old ones can be deleted from the same page."
            ]}
        ],
        "color": "#D4702A",
        "icon_key": "anthropic",
        "category": "llm",
    },

    "gemini": {
        "name": "Google Gemini",
        "description": "Use Google Gemini models as your AI provider",
        "auth_type": "api_key",
        "ui_fields": [
            {"name": "api_key", "label": "API Key", "placeholder": "Paste your Gemini API key", "type": "password"},
        ],
        "test_endpoint": None,
        "help_url": "https://aistudio.google.com/app/apikey",
        "instructions": (
            "1. Google Gemini is Google's AI model. You'll use Google AI Studio to get your key - it's free to start and includes a generous free tier, so you may not need to add billing right away.\n"
            "2. Open a browser and go to: aistudio.google.com. Sign in with your Google account (the same account you use for Gmail).\n"
            "3. Once you're inside Google AI Studio, look at the left sidebar. You should see a button or link that says 'Get API key'. Click it.\n"
            "4. You'land on the API Keys page. Click the blue button labeled 'Create API key'. A popup will appear - it will create the key inside a Google Cloud project. If you don't have one, it will create a default project for you automatically. Just click 'Create API key in new project'.\n"
            "5. Your API key will appear - it's a long string of letters and numbers. Click the copy icon next to it.\n"
            "6. Paste it into the 'API Key' field on the left. It should look like: AIzaSyxxxxxxxxxxxxxxxxxxxxxxxx.\n"
            "7. Click 'Connect'. Done - Google Gemini has a free quota, so most users won't need billing until they're doing heavy usage."
        ),
        "ui_flow": [
            {"type": "action", "label": "Open Google AI Studio", "url": "https://aistudio.google.com/app/apikey", "description": [
                "Click the button below to open Google AI Studio.",
                "Sign in with your regular Google account - the same one you use for Gmail.",
                "Google AI Studio has a free tier, so you can usually get started without adding any payment information."
            ]},
            {"type": "action", "label": "Create API Key", "url": "https://aistudio.google.com/app/apikey", "description": [
                "Once inside, click the blue button labeled 'Create API key'.",
                "A small popup may ask which Google Cloud project to use - if you don't know what to choose, just click 'Create API key in new project' and Google will handle the rest automatically.",
                "Your key will then appear on screen."
            ]},
            {"type": "input", "label": "API Key", "field": "api_key", "description": [
                "Click the copy icon next to the key that appeared, then paste it into the box below.",
                "It should start with 'AIzaSy' followed by more letters and numbers.",
                "This key is safe to use and Google's free quota covers most everyday usage."
            ]}
        ],
        "color": "#4285F4",
        "icon_key": "gemini",
        "category": "llm",
    },

    "groq": {
        "name": "Groq",
        "description": "Ultra-fast inference for Llama and Mixtral models",
        "auth_type": "api_key",
        "ui_fields": [
            {"name": "api_key", "label": "API Key", "placeholder": "Paste your Groq API key (starts with gsk_...)", "type": "password"},
        ],
        "test_endpoint": "https://api.groq.com/openai/v1/models",
        "help_url": "https://console.groq.com/keys",
        "instructions": (
            "1. Groq is a service that runs AI models extremely fast - it's great if you want near-instant responses. Best of all, it has a generous free plan that is enough for most everyday use with no credit card required.\n"
            "2. Open a browser and go to: console.groq.com. Click 'Sign up' if you don't have an account. You can sign up with Google, GitHub, or an email address - it takes under a minute.\n"
            "3. Once logged in, look at the left sidebar and click 'API Keys'. If you don't see a sidebar, click the menu icon in the top-left corner.\n"
            "4. Click the button labeled '+ Create API Key'. A popup will ask for a name - type 'AutoDeskAI' and click Submit.\n"
            "5. Your API key will appear - it starts with 'gsk_'. Copy the entire string right away, as it won't be shown again after you close the popup.\n"
            "6. Paste it into the 'API Key' field on the left. It should look like: gsk_xxxxxxxxxxxxxxxxxxxxxxxxxxxx.\n"
            "7. Click 'Connect'. Groq's free tier allows thousands of requests per day, so you likely won't hit any limits for normal use."
        ),
        "ui_flow": [
            {"type": "action", "label": "Go to Groq Console", "url": "https://console.groq.com/keys", "description": [
                "Click the button below to open Groq's developer console.",
                "Sign up for a free account if you don't have one - you can use Google, GitHub, or your email address.",
                "Groq is completely free to start with a generous daily limit, so no credit card is needed."
            ]},
            {"type": "action", "label": "Create API Key", "url": "https://console.groq.com/keys", "description": [
                "Once logged in, look at the left sidebar and click 'API Keys'.",
                "Then click '+ Create API Key', give it a name like 'AutoDeskAI', and click Submit.",
                "Your key will appear on screen - copy it straight away, as it won't be shown again after you close that popup."
            ]},
            {"type": "input", "label": "API Key", "field": "api_key", "description": [
                "Paste the key into the box below.",
                "It starts with 'gsk_' followed by a long string of characters.",
                "Groq's free tier allows thousands of requests per day, which is more than enough for regular everyday use."
            ]}
        ],
        "color": "#F55036",
        "icon_key": "groq",
        "category": "llm",
    },

    "mistral": {
        "name": "Mistral",
        "description": "Use Mistral AI models as your AI provider",
        "auth_type": "api_key",
        "ui_fields": [
            {"name": "api_key", "label": "API Key", "placeholder": "Paste your Mistral API key", "type": "password"},
        ],
        "test_endpoint": "https://api.mistral.ai/v1/models",
        "help_url": "https://console.mistral.ai/api-keys",
        "instructions": (
            "1. Mistral AI is a European AI company known for lightweight, fast models that are great for everyday tasks. There is a free trial period, and paid plans are available for heavy usage.\n"
            "2. Open a browser and go to: console.mistral.ai. Click 'Sign up' if you don't have an account - you can register with Google or an email address.\n"
            "3. After logging in, look at the left sidebar for 'API Keys' and click it. If you're taken to a workspace setup page first, complete the short setup (just choose a workspace name) and then navigate back to API Keys.\n"
            "4. Click the button labeled '+ Create new key'. A dialog will ask for a name - enter 'AutoDeskAI' or any name you prefer, then click 'Create'.\n"
            "5. Your API key will appear in the list. Click the copy icon next to it to copy it. It is a long string of random characters.\n"
            "6. Paste it into the 'API Key' field on the left.\n"
            "7. Click 'Connect' to finish. If you're on a free trial and it expires, you'll need to add billing at console.mistral.ai/billing to continue using Mistral."
        ),
        "ui_flow": [
            {"type": "action", "label": "Open Mistral Console", "url": "https://console.mistral.ai/api-keys", "description": ["Click the button below to open Mistral's developer console.", "Create a free account if you don't have one - registration takes about a minute using Google or an email address.", "Mistral offers a free trial period, so you can connect right away without entering payment information."]},
            {"type": "action", "label": "Create New Key", "url": "https://console.mistral.ai/api-keys", "description": ["Once logged in, look in the left sidebar for 'API Keys' and click it.", "On that page, click '+ Create new key', enter a name like 'AutoDeskAI', and then click Create.", "Your key will appear in the list - click the copy icon next to it to copy it to your clipboard."]},
            {"type": "input", "label": "API Key", "field": "api_key", "description": ["Paste the key you just copied into the box below.", "It is a long random string of characters.", "Once pasted, click Finish Setup and you are all done."]}
        ],
        "color": "#FF7000",
        "icon_key": "mistral",
        "category": "llm",
    },

    "deepseek": {
        "name": "DeepSeek",
        "description": "Cost-efficient reasoning and coding models",
        "auth_type": "api_key",
        "ui_fields": [
            {"name": "api_key", "label": "API Key", "placeholder": "Paste your DeepSeek API key", "type": "password"},
        ],
        "test_endpoint": "https://api.deepseek.com/v1/models",
        "help_url": "https://platform.deepseek.com/api_keys",
        "instructions": (
            "1. DeepSeek is known for powerful reasoning - it's especially good at tasks like analysis, math, and coding. It's one of the most affordable AI providers, so costs are very low even for heavy use.\n"
            "2. Open a browser and go to: platform.deepseek.com. Click 'Sign up' if you don't have an account. Registration is quick - use your email address or sign in with Google.\n"
            "3. Once logged in, look at the left sidebar and click 'API Keys'. You may need to verify your email address first if prompted.\n"
            "4. Click '+ Create new API key'. A dialog will appear - enter a name like 'AutoDeskAI' and click 'Create'.\n"
            "5. Your API key will appear on screen - it starts with 'sk-'. Copy it immediately; it will be hidden after you close the dialog.\n"
            "6. Paste it into the 'API Key' field on the left. It should look like: sk-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx.\n"
            "7. To use DeepSeek, you'll need a small amount of credit. Go to platform.deepseek.com/top_up to add funds - $5 is more than enough for months of regular use.\n"
            "8. Click 'Connect' to complete the setup."
        ),
        "ui_flow": [
            {"type": "action", "label": "Open DeepSeek Platform", "url": "https://platform.deepseek.com/api_keys", "description": [
                "Click the button below to open DeepSeek's developer platform.",
                "Sign up for a free account using your email address if you don't have one.",
                "Note: to actually use DeepSeek, you will need to add a small amount of credit (even $5 lasts months for regular use), but you can set everything up first and add billing later."
            ]},
            {"type": "action", "label": "Create API Key", "url": "https://platform.deepseek.com/api_keys", "description": [
                "Once logged in, find 'API Keys' in the left sidebar and click it.",
                "Click '+ Create new API key', enter a name like 'AutoDeskAI', and click Create.",
                "Your key will appear on screen - it starts with 'sk-'.",
                "Copy it immediately, as it will be hidden once you close the popup."
            ]},
            {"type": "input", "label": "API Key", "field": "api_key", "description": [
                "Paste the key you just copied into the box below.",
                "It should look like: sk-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx.",
                "Once both fields are filled, click Finish Setup to complete the connection."
            ]}
        ],
        "color": "#1B6EF3",
        "icon_key": "deepseek",
        "category": "llm",
    },

    "ollama": {
        "name": "Ollama (Local)",
        "description": "Run open-source models (Llama 3, Mistral) on your own hardware",
        "auth_type": "api_key",
        "ui_fields": [
            {"name": "api_base", "label": "Ollama Server URL", "placeholder": "http://localhost:11434/v1", "type": "text"},
            {"name": "model_name", "label": "Model Name", "placeholder": "e.g. llama3, mistral, gemma2", "type": "text"},
        ],
        "test_endpoint": None,  # local server may not be reachable at save time
        "help_url": "https://ollama.com/download",
        "instructions": (
            "1. Ollama lets you run AI models directly on your own computer - completely private, no data leaves your machine, and no ongoing costs after the one-time download. Your computer needs at least 8 GB of RAM for smaller models (16 GB recommended).\n"
            "2. Open a browser and go to: ollama.com/download. Choose the version for your operating system (Mac, Windows, or Linux) and download the installer. Run the installer like any normal app - just follow the on-screen steps.\n"
            "3. Once Ollama is installed, you need to download an AI model to your computer. Open a Terminal (on Mac: press Cmd+Space, type 'Terminal', press Enter) or Command Prompt (on Windows: press Win+R, type 'cmd', press Enter).\n"
            "4. In the terminal window, type the following and press Enter - this downloads the Llama 3 model (about 4 GB, takes a few minutes): ollama pull llama3\n"
            "5. Wait for the download to complete. You'll see a progress bar. Other popular models you can use instead: ollama pull mistral or ollama pull gemma2.\n"
            "6. Once downloaded, Ollama runs a local server automatically in the background. In the 'Ollama Server URL' field on the left, enter exactly: http://localhost:11434/v1\n"
            "7. In the 'Model Name' field, enter the exact model name you downloaded, for example: llama3 (or mistral, gemma2, etc.).\n"
            "8. Click 'Connect'. As long as Ollama is running on your computer, everything will work. Note: Ollama must be running whenever you use AutoDeskAI - if you restart your computer, open the Ollama app to start it again."
        ),
        "ui_flow": [
            {"type": "action", "label": "Download Ollama", "url": "https://ollama.com/download", "description": [
                "Click the button below to go to the Ollama website.",
                "Choose the version for your operating system (Mac or Windows), download the file, and open it to install Ollama just like any normal app.",
                "Your computer needs at least 8 GB of memory for this to work well."
            ]},
            {"type": "text", "description": [
                "After installing Ollama, you need to download an AI model to your computer.",
                "Open a Terminal (on Mac: press Cmd+Space, type Terminal, press Enter) or Command Prompt (on Windows: press the Windows key, type cmd, press Enter).",
                "Then type the following and press Enter: ollama pull llama3.",
                "This downloads the Llama 3 model - about 4 GB - and may take a few minutes depending on your internet speed.",
                "Once it finishes, Ollama will run a local server in the background automatically."
            ]},
            {"type": "input", "label": "Server URL", "field": "api_base", "description": [
                "In the box below, type exactly: http://localhost:11434/v1 - this is the address where Ollama is running on your computer.",
                "Do not change this unless you specifically configured Ollama to run on a different port."
            ]},
            {"type": "input", "label": "Model Name", "field": "model_name", "description": [
                "Type the name of the model you downloaded - for example: llama3.",
                "If you downloaded a different model, type that name instead (e.g. mistral or gemma2).",
                "This must match exactly what you typed in the 'ollama pull' command."
            ]}
        ],
        "color": "#000000",
        "icon_key": "ollama",
        "category": "llm",
    },

    "local_llm": {
        "name": "Local LLM (LM Studio)",
        "description": "Connect to any OpenAI-compatible local inference server",
        "auth_type": "api_key",
        "ui_fields": [
            {"name": "api_base", "label": "Server URL", "placeholder": "http://localhost:1234/v1", "type": "text"},
            {"name": "api_key", "label": "API Key (optional)", "placeholder": "Type anything, e.g. lm-studio", "type": "password"},
        ],
        "test_endpoint": None,  # local server may not be reachable at save time
        "help_url": "https://lmstudio.ai",
        "instructions": (
            "1. LM Studio is a free desktop application that lets you run AI models on your own computer. It's like having a private ChatGPT that never sends your data anywhere. Your computer needs at least 8 GB of RAM; 16 GB or more gives the best results.\n"
            "2. Open a browser and go to: lmstudio.ai. Click the download button for your operating system (Mac or Windows). Run the installer and open LM Studio - it looks like a chat app.\n"
            "3. Inside LM Studio, click the 'Discover' tab in the left sidebar (it looks like a search/magnifying glass icon). You'll see a catalog of AI models you can download. Search for 'llama' or 'mistral' and click Download on any model labeled 'Q4' or 'Q5' - these are smaller, faster versions.\n"
            "4. Wait for the model to download (it's usually 4–8 GB). You can see progress at the bottom of the screen.\n"
            "5. Once downloaded, click the 'Local Server' tab in the left sidebar (it looks like two arrows or a server icon). At the top of that page, click 'Select a model to load' and choose the model you just downloaded.\n"
            "6. Click the green 'Start Server' button. You'll see the server status change to 'Running' and a URL will appear at the top - it usually looks like: http://localhost:1234/v1. Copy that URL.\n"
            "7. Paste the server URL into the 'Server URL' field on the left. For the 'API Key' field, you can type anything at all - for example: lm-studio. Local servers don't check the API key, but the field needs something in it.\n"
            "8. Click 'Connect'. Keep LM Studio open and the server running while you use AutoDeskAI. If you close LM Studio or restart your computer, you'll need to start the server again from the Local Server tab."
        ),
        "ui_flow": [
            {"type": "action", "label": "Download LM Studio", "url": "https://lmstudio.ai", "description": [
                "Click the button below to go to the LM Studio website.",
                "Download the version for your computer (Mac or Windows), open the downloaded file, and follow the installation steps - it works just like installing any other app.",
                "Your computer needs at least 8 GB of memory for good performance."
            ]},
            {"type": "text", "description": [
                "Once LM Studio is open, click the 'Discover' tab in the left panel (it has a search icon).",
                "Search for a model like 'llama' or 'mistral' and click Download on one labeled Q4 or Q5 - these are smaller, faster versions that work well on most computers.",
                "After it finishes downloading, click the 'Local Server' tab in the left panel (the icon looks like two arrows).",
                "Select your downloaded model at the top, then click the green 'Start Server' button.",
                "A URL will appear - it usually looks like http://localhost:1234/v1.",
                "Keep LM Studio open while using AutoDeskAI."
            ]},
            {"type": "input", "label": "Server URL", "field": "api_base", "description": [
                "Copy the server URL that appeared in LM Studio (usually http://localhost:1234/v1) and paste it into the box below.",
                "For the API Key field, you can type anything at all - for example the word 'lm-studio'.",
                "Local servers don't check the key, but the field needs something in it to proceed."
            ]}
        ],
        "color": "#333333",
        "icon_key": "local_llm",
        "category": "llm",
    },
}


def get_platform(platform: str) -> dict | None:
    """Return platform config or None."""
    return INTEGRATION_REGISTRY.get(platform)


def get_oauth_platforms() -> list[str]:
    return [k for k, v in INTEGRATION_REGISTRY.items() if v["auth_type"] == "oauth2"]


def get_api_key_platforms() -> list[str]:
    return [k for k, v in INTEGRATION_REGISTRY.items() if v["auth_type"] in ("api_key", "bot_token")]
