!!! note "Configuration File Locations"

    Supersede Studio looks for specific files in specific locations. This is not configurable. Note that the user and admin files have different names

    === "MacOS"
        | Config | Location |
        | ---- | ------ |
        | User | ~/Library/Application Support/supersede-studio/user.config.ini |
        | Admin | /Library/Application Support/supersede-studio/system.config.ini |

    === "Linux"
        | Config | Location |
        | ---- | ----- |
        | User | ~/.config/supersede-studio/user.config.ini |
        | Admin | /etc/supersede-studio/system.config.ini |

    === "Windows"
        | Config | Location |
        | ---- | ----- |
        | User | %APPDATA%\supersede-studio\user.config.ini |
        | Admin | C:\ProgramData\supersede-studio\system.config.ini |

    === "Local Development"

        Put a `local.config.ini` in the root of the Supersede Studio project directory. This is used only during app development and takes the place of both user and admin files.