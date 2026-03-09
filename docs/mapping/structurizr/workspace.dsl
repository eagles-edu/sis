workspace "SIS Admin System" "C4 model for SIS admin runtime wiring" {
  model {
    admin = person "Admin User" "Manages student and class operations."
    teacher = person "Teacher User" "Performs data-entry and review workflows."

    sis = softwareSystem "SIS Hub" "Student Information System backend and admin UI." {
      adminUi = container "Admin UI" "Single-page admin interface" "HTML/CSS/JavaScript"
      api = container "API Service" "REST endpoints and routing layer" "Node.js (ESM)"
      db = container "SIS Database" "Student, attendance, grade, report records" "PostgreSQL"
      cache = container "Session/Filter Cache" "Session store and filter cache" "Redis"
      smtp = container "Mail Gateway" "Notification delivery" "SMTP"
    }

    admin -> adminUi "Uses"
    teacher -> adminUi "Uses"
    adminUi -> api "Calls /api/admin/* with cookie session"
    api -> db "Reads and writes SIS data"
    api -> cache "Stores session + filter cache"
    api -> smtp "Sends reminders/announcements"
  }

  views {
    systemContext sis "context" {
      include *
      autolayout lr
    }

    container sis "containers" {
      include *
      autolayout lr
    }

    theme default
  }
}
