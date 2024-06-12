# Change 

## 1.2.0
Resend email plugin to send transactional emails for Medusa.
Forked from the original version by Lacey Pevey.
Modified the extension mechanism for new events, 
1. Supporting dynamic addition of new events in the options definition within medusa-config.js, 
2. Dynamically added the origin=true attribute in the eventData of sendNotification. If this attribute is added, eventData will be treated as the original data directly.


## 1.1.0

- Update Resend SDK package dependency to v1.0

## 1.0.1

- Fix typo in README

## 1.0.0

- Bump to 1.0 since all planned features are implemented and stable
- Bump resend library dependency to latest version
- Print useful MedusaError messages to console when steps fail to assist with debugging and configuration

## 0.2.2

### Patch Changes

- Clean up dependencies (again) to address the circular dep CJS issue.  Be sure to yarn link all the peer deps if you want to make changes to the plugin locally.

## 0.2.1

### Patch Changes

- Print useful MedusaError messages to console when steps fail to assist with debugging and configuration

## 0.2.0

### Patch Changes

- Update import paths for compatibility with @medusajs/medusa 1.12.0

## 0.1.1

### Patch Changes

- Fixed import reference for helper functions from @medusajs/utils to medusa-core-utils

## 0.1.0

### Patch Changes

- Initial release
