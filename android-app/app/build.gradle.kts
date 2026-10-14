plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

// The game UI is the Vite build of ../web-game, packaged as app assets.
val webDist = rootProject.file("../web-game/dist")
val webAssetsDir = layout.buildDirectory.dir("generated/webassets")

val copyWebAssets by tasks.registering(Copy::class) {
    description = "Copies the built web game (web-game/dist) into the APK assets."
    doFirst {
        check(webDist.resolve("index.html").exists()) {
            "web-game/dist is missing. Run `npm ci && npm run build:web` in the repository root first."
        }
    }
    from(webDist)
    into(webAssetsDir.map { it.dir("web") })
}

android {
    namespace = "com.wanghanza.golfswingreader"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.wanghanza.golfswingreader"
        minSdk = 26
        targetSdk = 35
        versionCode = (System.getenv("GITHUB_RUN_NUMBER") ?: "1").toInt()
        versionName = "0.1.${System.getenv("GITHUB_RUN_NUMBER") ?: "0"}-dev"
    }

    signingConfigs {
        getByName("debug") {
            // Shared development key so successive CI builds install over each
            // other. NOT a release key.
            storeFile = rootProject.file("keystore/dev-debug.keystore")
            storePassword = "android"
            keyAlias = "androiddebugkey"
            keyPassword = "android"
        }
    }

    buildTypes {
        debug {
            applicationIdSuffix = ".dev"
        }
        release {
            isMinifyEnabled = false
            signingConfig = signingConfigs.getByName("debug")
        }
    }

    sourceSets["main"].assets.srcDir(webAssetsDir)

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions {
        jvmTarget = "17"
    }
    lint {
        abortOnError = false
    }
}

tasks.named("preBuild") { dependsOn(copyWebAssets) }

dependencies {
    testImplementation("junit:junit:4.13.2")
}
