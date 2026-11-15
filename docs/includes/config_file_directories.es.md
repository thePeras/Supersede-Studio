!!! note "Ubicaciones de Archivos de Configuracion"

    Supersede Studio busca archivos especificos en ubicaciones especificas. Esto no es configurable. Ten en cuenta que los archivos de usuario y administrador tienen nombres diferentes

    === "MacOS"
        | Config | Ubicacion |
        | ---- | ------ |
        | Usuario | ~/Library/Application Support/supersede-studio/user.config.ini |
        | Admin | /Library/Application Support/supersede-studio/system.config.ini |

    === "Linux"
        | Config | Ubicacion |
        | ---- | ----- |
        | Usuario | ~/.config/supersede-studio/user.config.ini |
        | Admin | /etc/supersede-studio/system.config.ini |

    === "Windows"
        | Config | Ubicacion |
        | ---- | ----- |
        | Usuario | %APPDATA%\supersede-studio\user.config.ini |
        | Admin | C:\ProgramData\supersede-studio\system.config.ini |

    === "Desarrollo Local"

        Coloca un `local.config.ini` en la raiz del directorio del proyecto de Supersede Studio. Esto se usa solo durante el desarrollo de la aplicacion y toma el lugar de los archivos de usuario y admin.
