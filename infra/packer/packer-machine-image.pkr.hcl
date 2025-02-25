packer {
  required_plugins {
    amazon-ebs = {
      source  = "github.com/hashicorp/amazon"
      version = ">= 1.0.0"
    }
    googlecompute = {
      source  = "github.com/hashicorp/googlecompute"
      version = ">= 1.0.0"
    }
  }
}

# AWS AMI Build
source "amazon-ebs" "ubuntu" {
  region                      = "us-east-1"
  source_ami                  = "ami-0609a4e88e9e5a526"
  instance_type               = "t2.micro"
  ssh_username                = "ubuntu"
  ami_name                    = "custom-nodejs-mysql-{{timestamp}}"
  ami_description             = "Custom image with Node.js binary and MySQL"
  associate_public_ip_address = true
  ssh_timeout                 = "10m"
}

# GCP Image Build
source "googlecompute" "ubuntu" {
  project_id           = "dev-project-452007"
  source_image         = "ubuntu-2404-noble-amd64-v20250214"
  machine_type         = "e2-medium"
  zone                 = "us-east1-b"
  image_name           = "custom-nodejs-mysql-{{timestamp}}"
  image_family         = "custom-images"
  image_description    = "Custom GCP image with Node.js and MySQL"
  ssh_username         = "ubuntu"
  wait_to_add_ssh_keys = "10s"
}

build {
  sources = [
    # "source.amazon-ebs.ubuntu",
    "source.googlecompute.ubuntu"
  ]

  provisioner "file" {
    source      = "dist/webapp"
    destination = "/tmp/webapp"
  }

  provisioner "file" {
    source      = "setup.sh"
    destination = "/tmp/setup.sh"
  }

  provisioner "file" {
    source      = "webapp.service"
    destination = "/tmp/webapp.service"
  }

  provisioner "shell" {
    inline = [
      "chmod +x /tmp/setup.sh",
      "sudo /tmp/setup.sh"
    ]
  }
}