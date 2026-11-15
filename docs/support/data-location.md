---
title: Data Storage Location
summary: "Where Supersede Studio stores your SQL queries and connections when you save them."
old_url: "https://docs.supersedestudio.io/docs/deep-dive-overview"
---

When you save connections and SQL queries in Supersede Studio they are persisted to a SQLite database in the application configuration directory.

## Database Location

The database is named `app.db` and is stored in the `userData` folder which the operating system provides for Supersede Studio to store settings and preferences.

### UserData directory locations:

- Windows: `<User Directory>\AppData\Roaming\supersede-studio`
- MacOS: `~/Library/Application Support/Supersede Studio`
    - Note: The ~/Library directory is typically hidden in Finder. However, you can use Go -> Go to Folder to open this directory.
- Linux: `~/.config/supersede-studio`

## Access the Supersede Studio Database....From Supersede Studio

If you navigate to `Help -> Add Supersede's Database` the app will add a new database connection for you to use - Supersede's database itself.

You can use this connection to explore your saved data, export SQL queries, or do whatever you need.
