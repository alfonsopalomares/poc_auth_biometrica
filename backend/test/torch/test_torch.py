import torch


def main():
    print("PyTorch test: checking availability...")
    print(f"torch.__version__ = {torch.__version__}")
    print(f"cuda available = {torch.cuda.is_available()}")
    x = torch.tensor([1.0, 2.0, 3.0])
    y = x * 2
    print(f"tensor x = {x}")
    print(f"tensor y = {y}")


if __name__ == '__main__':
    main()
