# Product guide

Matron is a household organizer: a shared calendar, lists, reminders and an assistant, for the members of one household. This page says what the app does today, feature by feature, in the words a member would use. A change that adds to what members can do, or changes it, updates this page in the same change.

How the app is built is in [app-architecture.md](app-architecture.md). How it changes itself is in [router-architecture.md](router-architecture.md).

## Members and roles

A household is a closed group. Nobody signs up: an owner or an admin adds each member with a name, an email and a password. Every member has one role.

| Role   | Besides using the app                                                                                                      |
| ------ | -------------------------------------------------------------------------------------------------------------------------- |
| member | Nothing more.                                                                                                              |
| admin  | Adds and removes members and changes their roles, except owners. Asks for changes to the app and tries them on a branch.   |
| owner  | Everything an admin does, and: reads a branch's code, merges it, sets the app settings, and uses the Troubleshooting page. |

Using the app is the same for every role. An owner sees the events and lists they made or were given, like anyone else.

## Pages

Every member has Calendar (the start page), Lists, Conversations and Settings. Owners and admins also have Users and Builds; owners also have App settings and Troubleshooting. An Ask button on every page opens the assistant. Owners and admins also have a Build button, which opens the build chat, and a branch switcher.

## Calendar

- **Views.** Day, week and month. The view chosen is kept on the device. An event is moved or resized by dragging it, with a mouse or a finger.
- **Events.** A title, a description, a location, and an all-day span or a time range in a time zone. Whoever makes an event attends it.
- **Location.** Typed freely. Once the household has set up Google Places in App settings, places are suggested while typing, and a picked place links to Google Maps.
- **Repeating.** Daily, weekly on chosen weekdays, monthly on days of the month or the nth weekday (the last Friday), or yearly; every so many; forever, until a day, or a number of times. Times hold across daylight-saving changes. One occurrence can be changed or removed on its own, and a repetition can be stopped from a day on, keeping what came before.
- **Calendars.** Every event belongs to one of its creator's calendars and shows in that calendar's colour. Each member has a default calendar, where new events go, and adds, renames, recolours and removes others in their settings.
- **Sharing an event.** An event is shared with chosen members. Everyone it is shared with sees it. Sharing it further and editing it are each given on their own, per member. Who attends is chosen among the people it is shared with. A member can leave an event shared with them, or place it in one of their own calendars.
- **Sharing a calendar.** A member shares any of their calendars read-only with other members. A viewer sees every event in it, changes nothing, picks their own colour for it, and can stop seeing it.
- **Hiding and filters.** A member hides an event from their own calendar; it comes back through the filters. The filters also show or leave out each calendar, and list items with a due day, which the calendar shows on that day.
- **Google Calendar import.** One way, from Google to Matron. Once the household's Google app is set up in App settings, each member links their own Google account in their settings and picks which Google calendars to import. Imported events are read-only here, except for who they are shared with, and each links back to Google. Google's changes arrive as they happen and in a full sync once a day.

## Lists

- **A list** has a name and a colour. It is shared with chosen members: everyone it is shared with sees it, and editing it and sharing it further are each given on their own. Only whoever made the list removes it.
- **Items** have a title and may have a description, a due day and the people they are assigned to, who are always people who see the list. An item is ticked off when done.
- **Nesting and order.** Items nest under other items and keep the order they are dragged into. An item moves with the items under it, also to another list. Removing an item removes the items under it.
- **The Lists page** shows every list as a card, last changed first. It searches list names and items, and a list can be pinned on the device.

## Reminders

- Matron installs on a phone or a computer as an app. Each device is subscribed to reminders from Settings.
- A member sets their own reminder on an event or on a list item with a due day: 5, 10, 15 or 30 minutes, or 1 or 2 hours before. It arrives as a notification on their subscribed devices.
- A reminder follows its event when the event moves, and a repeating event keeps it for every occurrence.

## Assistant

- The Ask button opens a chat with the assistant. It answers questions about the household's calendar and lists, and changes them when asked.
- It acts as the member it talks with and can do no more than they can in the app. It asks before removing anything.
- A message can carry pictures, PDFs and text files, such as an invitation to put on the calendar.
- For questions its tools do not answer, it looks the household's data up, read-only, within what the member's role may read.
- Conversations are kept on the Conversations page, where they are renamed and archived. An archived conversation can be read and not continued.

## Settings

- **Settings** (every member): their name, picture and password, not their email. Their calendars, their Google Calendar link, and reminders on this device.
- **Users** (owners and admins): add a member, change a role, remove a member.
- **App settings** (owners): the model the planner and builder use, the model the assistant uses, the household's Google app for the calendar import, and a Google Places key for location suggestions. Secrets entered there are never shown again in full.

## Changing the app

- An owner or admin describes a change in the build chat. A planner writes a plan. When the request already says enough, the build starts at once; otherwise the planner asks what is still open and waits for a yes.
- A builder then makes the change on a branch and deploys it beside the app, with its own copy of the household's data. This usually takes five to ten minutes. The chat gives a link to try it.
- On a branch, the same chat takes further requests for that change. Data changed on a branch is not kept.
- An owner reads the branch's code if they wish and merges it for everyone. A merge runs every test first, and stops with nothing changed if one fails. A branch that is not wanted is abandoned.
- The Builds page lists build chats. Troubleshooting (owners) shows the deployment's databases, containers and branches, takes in updates from the upstream project, and can take production back to before a merged branch.

## What Matron does not do

- It sends no email and no text messages. Reminders are push notifications only.
- It has no sign-up and no pages for people outside the household.
- It writes nothing to Google: the calendar import is one way.
