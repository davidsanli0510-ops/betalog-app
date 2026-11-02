package com.betalog.app;

import android.Manifest;
import android.content.ContentValues;
import android.media.MediaScannerConnection;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.MediaStore;
import android.util.Base64;
import android.view.WindowManager;

import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.OutputStream;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Native helpers the web app calls (frontend/src/native.ts):
 *  - keepScreenOn: keep the display awake while the replay buffer records
 *  - saveStart / saveAppend / saveFinish: write a video into the gallery (Movies/BetaLog), streamed in base64 chunks
 */
@CapacitorPlugin(
    name = "BetaLogNative",
    permissions = { @Permission(alias = "storage", strings = { Manifest.permission.WRITE_EXTERNAL_STORAGE }) }
)
public class BetaLogNativePlugin extends Plugin {
    private final Map<String, OutputStream> outs = new ConcurrentHashMap<>();
    private final Map<String, Uri> uris = new ConcurrentHashMap<>();
    private final Map<String, File> files = new ConcurrentHashMap<>();

    @PluginMethod
    public void keepScreenOn(PluginCall call) {
        final boolean on = Boolean.TRUE.equals(call.getBoolean("on", false));
        getActivity().runOnUiThread(() -> {
            if (on) getActivity().getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
            else getActivity().getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
            call.resolve();
        });
    }

    @PluginMethod
    public void saveStart(PluginCall call) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q && getPermissionState("storage") != PermissionState.GRANTED) {
            requestPermissionForAlias("storage", call, "storagePermissionCallback");
            return;
        }
        startSave(call);
    }

    @PermissionCallback
    private void storagePermissionCallback(PluginCall call) {
        if (getPermissionState("storage") == PermissionState.GRANTED) startSave(call);
        else call.reject("갤러리에 저장하려면 저장 권한이 필요해요.");
    }

    private void startSave(PluginCall call) {
        String name = call.getString("name", "climb.mp4");
        String mime = call.getString("mime", "video/mp4");
        try {
            String id = UUID.randomUUID().toString();
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                ContentValues v = new ContentValues();
                v.put(MediaStore.Video.Media.DISPLAY_NAME, name);
                v.put(MediaStore.Video.Media.MIME_TYPE, mime);
                v.put(MediaStore.Video.Media.RELATIVE_PATH, Environment.DIRECTORY_MOVIES + "/BetaLog");
                v.put(MediaStore.Video.Media.IS_PENDING, 1);
                Uri uri = getContext().getContentResolver().insert(MediaStore.Video.Media.EXTERNAL_CONTENT_URI, v);
                if (uri == null) throw new IOException("could not create the gallery entry");
                OutputStream o = getContext().getContentResolver().openOutputStream(uri);
                if (o == null) throw new IOException("could not open the gallery entry");
                outs.put(id, o);
                uris.put(id, uri);
            } else {
                File dir = new File(Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_MOVIES), "BetaLog");
                if (!dir.exists() && !dir.mkdirs()) throw new IOException("could not create " + dir);
                File f = new File(dir, name);
                outs.put(id, new FileOutputStream(f));
                files.put(id, f);
            }
            JSObject r = new JSObject();
            r.put("id", id);
            call.resolve(r);
        } catch (Exception e) {
            call.reject("저장을 시작하지 못했어요: " + e.getMessage());
        }
    }

    @PluginMethod
    public void saveAppend(PluginCall call) {
        OutputStream o = outs.get(call.getString("id", ""));
        if (o == null) {
            call.reject("unknown save id");
            return;
        }
        try {
            o.write(Base64.decode(call.getString("data", ""), Base64.DEFAULT));
            call.resolve();
        } catch (Exception e) {
            call.reject("저장 중에 실패했어요: " + e.getMessage());
        }
    }

    @PluginMethod
    public void saveFinish(PluginCall call) {
        String id = call.getString("id", "");
        OutputStream o = outs.remove(id);
        if (o == null) {
            call.reject("unknown save id");
            return;
        }
        try {
            o.close();
            String path;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                Uri uri = uris.remove(id);
                ContentValues v = new ContentValues();
                v.put(MediaStore.Video.Media.IS_PENDING, 0);
                getContext().getContentResolver().update(uri, v, null, null);
                path = String.valueOf(uri);
            } else {
                File f = files.remove(id);
                MediaScannerConnection.scanFile(getContext(), new String[] { f.getAbsolutePath() }, null, null);
                path = f.getAbsolutePath();
            }
            JSObject r = new JSObject();
            r.put("path", path);
            call.resolve(r);
        } catch (Exception e) {
            call.reject("저장을 마치지 못했어요: " + e.getMessage());
        }
    }
}
