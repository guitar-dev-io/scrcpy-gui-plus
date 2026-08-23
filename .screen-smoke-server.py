#!/usr/bin/env python3
import json
import queue
import socket
import struct
import threading

ADVERTISE_HOST = "10.0.2.2"
PAIRING_TOKEN = "ab" * 32
stop_event = threading.Event()
command_queue = queue.Queue()
control_lock = threading.Lock()
active_control = None
next_generation = 0
next_request_id = 1

def read_frame(connection, maximum=2 * 1024 * 1024):
    header = connection.recv(4)
    if not header:
        return None
    if len(header) != 4:
        raise EOFError("partial frame header")
    length = struct.unpack(">I", header)[0]
    if length < 1 or length > maximum:
        raise ValueError(f"invalid frame length {length}")
    payload = bytearray()
    while len(payload) < length:
        chunk = connection.recv(length - len(payload))
        if not chunk:
            raise EOFError("partial frame payload")
        payload.extend(chunk)
    return bytes(payload)


def write_frame(connection, payload):
    connection.sendall(struct.pack(">I", len(payload)) + payload)


def bind_listener(address="0.0.0.0", port=0):
    listener = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    listener.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    listener.bind((address, port))
    listener.listen(8)
    listener.settimeout(1.0)
    return listener


def screen_worker(listener, stream_token, stream_generation):
    port = listener.getsockname()[1]
    print(
        f"SCREEN_LISTENER host={ADVERTISE_HOST} port={port} generation={stream_generation} "
        f"token={stream_token}",
        flush=True,
    )
    accepted = 0
    try:
        while not stop_event.is_set():
            try:
                connection, peer = listener.accept()
            except socket.timeout:
                continue
            accepted += 1
            with connection:
                connection.settimeout(30.0)
                try:
                    hello = json.loads(read_frame(connection, 16 * 1024))
                    print(
                        f"SCREEN_HELLO attempt={accepted} peer={peer[0]} type={hello.get('type')} "
                        f"generation={hello.get('generation')} size={hello.get('width')}x{hello.get('height')} "
                        f"message={hello.get('message')}",
                        flush=True,
                    )
                    frame_count = 0
                    while not stop_event.is_set():
                        frame = read_frame(connection)
                        if frame is None:
                            break
                        frame_count += 1
                        if frame_count == 1 or frame_count % 12 == 0:
                            print(
                                f"SCREEN_FRAME attempt={accepted} count={frame_count} bytes={len(frame)}",
                                flush=True,
                            )
                        # Deliberately close the first authenticated socket. The Android capture
                        # session must keep MediaProjection alive and establish attempt 2.
                        if accepted == 1 and frame_count >= 1:
                            print("SCREEN_DROP first authenticated socket", flush=True)
                            break
                except (EOFError, OSError, ValueError, json.JSONDecodeError) as error:
                    print(f"SCREEN_SOCKET attempt={accepted} closed={error}", flush=True)
    finally:
        listener.close()
        print(f"SCREEN_LISTENER_CLOSED generation={stream_generation}", flush=True)


def next_ids():
    global next_generation, next_request_id
    next_generation += 1
    request_id = next_request_id
    next_request_id += 1
    return next_generation, request_id


def send_screen_start(connection):
    generation, request_id = next_ids()
    stream_token = (f"{generation:02x}" * 64)[:64]
    listener = bind_listener()
    port = listener.getsockname()[1]
    threading.Thread(
        target=screen_worker,
        args=(listener, stream_token, generation),
        daemon=True,
    ).start()
    params = {
        "host": ADVERTISE_HOST,
        "port": port,
        "token": stream_token,
        "generation": generation,
        "maxWidth": 720,
        "maxHeight": 1280,
        "maxFps": 12,
        "jpegQuality": 60,
    }
    request = {
        "type": "request",
        "id": request_id,
        "method": "start_screen_share",
        "params": params,
    }
    print(
        f"SCREEN_PARAMS host={ADVERTISE_HOST} port={port} generation={generation}",
        flush=True,
    )
    with control_lock:
        write_frame(connection, json.dumps(request, separators=(",", ":")).encode())
        response = json.loads(read_frame(connection, 1024 * 1024))
    print(
        f"SCREEN_START_RESPONSE id={response.get('id')} ok={response.get('ok')} "
        f"result={response.get('result')} error={response.get('error')}",
        flush=True,
    )


def send_screen_stop(connection):
    global next_request_id
    request_id = next_request_id
    next_request_id += 1
    request = {
        "type": "request",
        "id": request_id,
        "method": "stop_screen_share",
        "params": {},
    }
    with control_lock:
        write_frame(connection, json.dumps(request, separators=(",", ":")).encode())
        response = json.loads(read_frame(connection, 1024 * 1024))
    print(
        f"SCREEN_STOP_RESPONSE id={response.get('id')} ok={response.get('ok')} "
        f"result={response.get('result')} error={response.get('error')}",
        flush=True,
    )


def handle_control(connection, peer):
    global active_control
    with connection:
        connection.settimeout(30.0)
        try:
            hello = json.loads(read_frame(connection, 1024 * 1024))
            print(
                f"CONTROL_HELLO peer={peer[0]} type={hello.get('type')} "
                f"token_ok={hello.get('token') == PAIRING_TOKEN}",
                flush=True,
            )
            active_control = connection
            if next_generation == 0:
                send_screen_start(connection)
            while not stop_event.is_set():
                try:
                    command = command_queue.get(timeout=1.0)
                except queue.Empty:
                    continue
                if command == "start":
                    send_screen_start(connection)
                elif command == "stop":
                    send_screen_stop(connection)
                elif command == "quit":
                    stop_event.set()
                    return
        except (EOFError, OSError, ValueError, json.JSONDecodeError) as error:
            print(f"CONTROL_SOCKET peer={peer[0]} closed={error}", flush=True)
        finally:
            if active_control is connection:
                active_control = None


def command_worker(listener):
    print(f"COMMAND_LISTENER port={listener.getsockname()[1]}", flush=True)
    try:
        while not stop_event.is_set():
            try:
                connection, _ = listener.accept()
            except socket.timeout:
                continue
            with connection:
                command = connection.recv(64).decode().strip()
                if command:
                    print(f"COMMAND {command}", flush=True)
                    command_queue.put(command)
    finally:
        listener.close()


def main():
    control_listener = bind_listener(port=53148)
    command_listener = bind_listener("127.0.0.1")
    threading.Thread(target=command_worker, args=(command_listener,), daemon=True).start()
    print(
        f"PAIRING host={ADVERTISE_HOST} port={control_listener.getsockname()[1]} "
        f"token={PAIRING_TOKEN}",
        flush=True,
    )
    try:
        while not stop_event.is_set():
            try:
                connection, peer = control_listener.accept()
            except socket.timeout:
                continue
            threading.Thread(target=handle_control, args=(connection, peer), daemon=True).start()
    finally:
        stop_event.set()
        control_listener.close()


if __name__ == "__main__":
    main()
