# TurboMailer Pro API Documentation

## Authentication

All API endpoints require authentication via one of:
- **Session Cookie** (browser-based login)
- **Authorization Header**: `Bearer <jwt_token>`
- **API Key Header**: `x-api-key: <api_key>`

### Auth Endpoints

| Method | Path | Description |
|--------|------|-------------|
| POST | /api/auth/login | Login with username/password |
| POST | /api/auth/logout | Logout |
| GET | /api/auth/me | Get current user |
| POST | /api/auth/2fa/setup | Setup 2FA |
| POST | /api/auth/2fa/verify | Verify 2FA token |
| POST | /api/auth/2fa/authenticate | Authenticate with 2FA |
| GET | /api/auth/users | List users (admin) |
| POST | /api/auth/users | Create user (admin) |
| POST | /api/auth/api-key | Generate API key |

### SMTP Servers

| Method | Path | Description |
|--------|------|-------------|
| GET | /api/smtp | List SMTP servers |
| GET | /api/smtp/:id | Get SMTP server |
| POST | /api/smtp | Add SMTP server |
| PUT | /api/smtp/:id | Update SMTP server |
| DELETE | /api/smtp/:id | Delete SMTP server |
| POST | /api/smtp/:id/test | Test connection |

### Templates

| Method | Path | Description |
|--------|------|-------------|
| GET | /api/templates | List templates |
| GET | /api/templates/:id | Get template |
| POST | /api/templates | Create template |
| PUT | /api/templates/:id | Update template |
| DELETE | /api/templates/:id | Delete template |
| POST | /api/templates/:id/default | Set as default |

### Campaigns

| Method | Path | Description |
|--------|------|-------------|
| GET | /api/campaigns | List campaigns |
| GET | /api/campaigns/:id | Get campaign details |
| POST | /api/campaigns | Create campaign |
| PUT | /api/campaigns/:id | Update campaign |
| DELETE | /api/campaigns/:id | Delete campaign |
| POST | /api/campaigns/:id/start | Start campaign |
| POST | /api/campaigns/:id/pause | Pause campaign |
| POST | /api/campaigns/:id/resume | Resume campaign |
| POST | /api/campaigns/:id/cancel | Cancel campaign |
| GET | /api/campaigns/:id/recipients | Get campaign recipients |

### External API (Send Email)

| Method | Path | Description |
|--------|------|-------------|
| POST | /api/send | Send single email |
| POST | /api/send/bulk | Send bulk email |

Example:
```json
POST /api/send
{
  "to": "user@example.com",
  "subject": "Hello",
  "html": "<h1>Hello {{first_name}}</h1>",
  "from_name": "Company",
  "from_email": "noreply@company.com",
  "smtp_server_id": "uuid"
}